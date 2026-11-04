/**
 * Groups faces into people, on the device. People the user has named, merged or hidden come
 * first: each new face joins the person whose confirmed faces it looks most like, unless it
 * was turned down for them. The faces left over are grouped with each other. Fingerprints
 * can always be found again; what the user did can't, so only that is saved (in people
 * records), and the groups themselves are worked out again whenever they're needed.
 */
import { cosine } from './vectors';
import type { FaceResults, StoredFace } from './segment';

/** A face joins a person when it's at least this similar to them. */
export const JOIN_PERSON = 0.42;
/** Leftover faces group together when at least this similar. */
export const JOIN_GROUP = 0.45;
/** A group nobody has named is shown once it has faces in this many photos. */
export const MIN_GROUP_PHOTOS = 3;
/** Most faces a person record keeps as confirmed, and as turned down. */
export const MAX_PERSON_FACES = 30;

/** One face: which photo, and which of its faces (`photoId#index`). */
export type FaceRef = string;

export function faceRef(photoId: string, index: number): FaceRef {
  return `${photoId}#${String(index)}`;
}

export function photoOf(ref: FaceRef): string {
  return ref.slice(0, ref.lastIndexOf('#'));
}

/** What the user decided about one person. */
export interface Person {
  id: string;
  /** Empty until named. */
  name: string;
  /** Faces confirmed as this person, best first. */
  faces: FaceRef[];
  /** Faces the user said aren't this person. */
  rejected: FaceRef[];
  hidden: boolean;
  /** Whether this is the person using Arcafold: at most one person in a space. */
  me: boolean;
  /** Groups they belong to, so searches like "my friends" mean something. */
  labels: PersonLabel[];
}

/** The groups a person can be put in. */
export const PERSON_LABELS = ['friends', 'family', 'work'] as const;
export type PersonLabel = (typeof PERSON_LABELS)[number];

/**
 * The people to save when `person` becomes (or stops being) the one using Arcafold: them,
 * and anyone else who was marked so, since only one person can be.
 */
export function meChanges(people: readonly Person[], person: Person, me: boolean): Person[] {
  const others = me
    ? people
        .filter((other) => other.me && other.id !== person.id)
        .map((other) => ({ ...other, me: false }))
    : [];
  return [...others, { ...person, me }];
}

export const isPersonLabel = (value: unknown): value is PersonLabel =>
  (PERSON_LABELS as readonly unknown[]).includes(value);

export interface Face extends StoredFace {
  ref: FaceRef;
  photoId: string;
}

/** A group to show: a person the user decided about, or faces grouped on their own. */
export interface Group {
  /** The person's id, or `group:` and the group's best face. */
  id: string;
  person: Person | null;
  /** Its faces, best first. */
  faces: Face[];
  /** Photos with any of its faces, newest first per the order given. */
  photoIds: string[];
}

/** Bigger, clearer faces first: they make better covers and better groups. */
function quality(face: StoredFace): number {
  return face.width * face.height * face.score;
}

function byQuality(a: Face, b: Face): number {
  return quality(b) - quality(a) || (a.ref < b.ref ? -1 : 1);
}

export function allFaces(results: FaceResults): Face[] {
  const faces: Face[] = [];
  for (const [photoId, stored] of results) {
    stored.forEach((face, index) => {
      faces.push({ ...face, ref: faceRef(photoId, index), photoId });
    });
  }
  return faces;
}

/** The average of unit vectors, scaled back to length 1. */
function centroid(vectors: readonly Float32Array[]): Float32Array | null {
  const first = vectors[0];
  if (!first) return null;
  const sum = new Float32Array(first.length);
  for (const vector of vectors) {
    for (let i = 0; i < sum.length; i++) sum[i] = (sum[i] ?? 0) + (vector[i] ?? 0);
  }
  let length = 0;
  for (const v of sum) length += v * v;
  length = Math.sqrt(length);
  return length > 0 ? sum.map((v) => v / length) : null;
}

interface Cluster {
  faces: Face[];
  sum: Float32Array;
  /** `sum` scaled to length 1, kept up to date so comparing is one dot product. */
  center: Float32Array;
}

function addTo(cluster: Cluster, face: Face): void {
  cluster.faces.push(face);
  let length = 0;
  for (let i = 0; i < cluster.sum.length; i++) {
    cluster.sum[i] = (cluster.sum[i] ?? 0) + (face.embedding[i] ?? 0);
    length += (cluster.sum[i] ?? 0) ** 2;
  }
  length = Math.sqrt(length);
  for (let i = 0; i < cluster.sum.length; i++) {
    cluster.center[i] = length > 0 ? (cluster.sum[i] ?? 0) / length : 0;
  }
}

/**
 * Groups faces by similarity: each face, best first, joins the closest group or starts one,
 * then every face moves to the group it's closest to overall.
 */
function cluster(faces: readonly Face[]): Face[][] {
  const clusters: Cluster[] = [];
  for (const face of [...faces].sort(byQuality)) {
    let best: Cluster | null = null;
    let bestScore = JOIN_GROUP;
    for (const candidate of clusters) {
      const score = cosine(candidate.center, face.embedding);
      if (score >= bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (best) {
      addTo(best, face);
    } else {
      const fresh = new Float32Array(face.embedding.length);
      clusters.push({ faces: [face], sum: Float32Array.from(face.embedding), center: fresh });
      fresh.set(face.embedding);
    }
  }
  // One more pass, now that every group's center is known.
  const settled: Face[][] = clusters.map(() => []);
  for (const face of faces) {
    let bestIndex = -1;
    let bestScore = JOIN_GROUP;
    clusters.forEach((candidate, index) => {
      const score = cosine(candidate.center, face.embedding);
      if (score >= bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    });
    if (bestIndex >= 0) settled[bestIndex]?.push(face);
    else settled.push([face]);
  }
  return settled.filter((group) => group.length > 0).map((group) => group.sort(byQuality));
}

function photosOf(faces: readonly Face[], order: ReadonlyMap<string, number>): string[] {
  const ids = [...new Set(faces.map((face) => face.photoId))];
  return ids.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/**
 * Every group: people first (in the order given), then groups nobody has named yet with
 * faces in at least MIN_GROUP_PHOTOS photos, biggest first. `photoOrder` lists the photos
 * that are still here, in the order to show them; faces of other photos are left out.
 */
export function groupFaces(
  results: FaceResults,
  people: readonly Person[],
  photoOrder: readonly string[],
): Group[] {
  const order = new Map(photoOrder.map((id, index) => [id, index]));
  const faces = allFaces(results).filter((face) => order.has(face.photoId));
  const byRef = new Map(faces.map((face) => [face.ref, face]));

  // A face confirmed for a person belongs to them, whatever it looks like.
  const owner = new Map<FaceRef, Person>();
  for (const person of people) {
    for (const ref of person.faces) if (byRef.has(ref) && !owner.has(ref)) owner.set(ref, person);
  }
  const centers = people.map((person) => ({
    person,
    rejected: new Set(person.rejected),
    center: centroid(
      person.faces.flatMap((ref) => {
        const face = byRef.get(ref);
        return face && owner.get(ref) === person ? [face.embedding] : [];
      }),
    ),
  }));

  const members = new Map<Person, Face[]>(people.map((person) => [person, []]));
  const leftover: Face[] = [];
  for (const face of faces) {
    const confirmed = owner.get(face.ref);
    if (confirmed) {
      members.get(confirmed)?.push(face);
      continue;
    }
    let best: Person | null = null;
    let bestScore = JOIN_PERSON;
    for (const { person, rejected, center } of centers) {
      if (!center || rejected.has(face.ref)) continue;
      const score = cosine(center, face.embedding);
      if (score >= bestScore) {
        best = person;
        bestScore = score;
      }
    }
    if (best) members.get(best)?.push(face);
    else leftover.push(face);
  }

  const groups: Group[] = people.map((person) => {
    const own = (members.get(person) ?? []).sort(byQuality);
    return { id: person.id, person, faces: own, photoIds: photosOf(own, order) };
  });
  const unnamed = cluster(leftover)
    .map((group) => ({
      id: `group:${group[0]?.ref ?? ''}`,
      person: null,
      faces: group,
      photoIds: photosOf(group, order),
    }))
    .filter((group) => group.photoIds.length >= MIN_GROUP_PHOTOS)
    .sort((a, b) => b.photoIds.length - a.photoIds.length);
  return [...groups, ...unnamed];
}

/** Faces to keep as a person's confirmed ones: the best, without repeats, at most the cap. */
export function confirmedFaces(...lists: readonly (readonly FaceRef[])[]): FaceRef[] {
  return [...new Set(lists.flat())].slice(0, MAX_PERSON_FACES);
}

/** Adds faces to a person's turned-down list, keeping the most recent ones. */
export function withRejected(person: Person, refs: readonly FaceRef[]): Person {
  const rejected = [...new Set([...refs, ...person.rejected])].slice(0, MAX_PERSON_FACES);
  const gone = new Set(refs);
  return { ...person, rejected, faces: person.faces.filter((ref) => !gone.has(ref)) };
}
