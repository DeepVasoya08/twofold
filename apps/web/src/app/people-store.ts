import type { SpaceKeys } from '@twofold/crypto';
import { FACE_SEGMENT_DELETE_MAX } from '@twofold/types';

import { spaceApi } from '../lib/api';
import type { SpaceApi } from '../lib/api';
import { MAX_PERSON_FACES } from '../lib/people/grouping';
import { isPersonLabel } from '../lib/people/grouping';
import type { Person, PersonLabel } from '../lib/people/grouping';
import { decodeSegment, encodeSegment, splitResults } from '../lib/people/segment';
import type { FaceResults } from '../lib/people/segment';

/**
 * The open space's people, stored sealed under its own key: face results in segments, and
 * one record per person. Everything here is owner-only, so it always uses the space's own
 * token, never a share token; results for photos in libraries shared with you are kept here
 * too, in your own space.
 */

/** Largest segment before sealing; padding and the seal must still fit FACE_SIZES.maxSegment. */
export const SEGMENT_BYTES = 224 * 1024;

export interface SavedPeople {
  results: FaceResults;
  people: Person[];
  /** Ids of the segments the results came from, to merge them later. */
  segments: string[];
}

export interface PeopleStore {
  load: () => Promise<SavedPeople>;
  /** Saves results for some photos, as one new segment or more, and returns their ids. */
  saveResults: (results: FaceResults) => Promise<string[]>;
  /**
   * Replaces segments with new ones holding `results` (usually everything still wanted), and
   * returns the new ones' ids. They're saved first, so a failure part way loses nothing.
   */
  replaceSegments: (results: FaceResults, old: readonly string[]) => Promise<string[]>;
  savePerson: (person: Person) => Promise<void>;
  deletePerson: (id: string) => Promise<void>;
  /** Forgets every face and person in the space. */
  forget: () => Promise<void>;
  newId: () => Promise<string>;
}

interface PersonMeta {
  v: 1;
  name: string;
  faces: string[];
  rejected: string[];
  hidden: boolean;
  /** Left out by versions before "This is me"; read as false. */
  me?: boolean;
  /** Left out by versions before labels; read as none. */
  labels?: PersonLabel[];
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function parsePerson(id: string, value: unknown): Person | null {
  if (typeof value !== 'object' || value === null) return null;
  const { v, name, faces, rejected, hidden, me, labels } = value as Record<string, unknown>;
  if (v !== 1 || typeof name !== 'string' || typeof hidden !== 'boolean') return null;
  if (!isStringList(faces) || !isStringList(rejected)) return null;
  if (me !== undefined && typeof me !== 'boolean') return null;
  if (labels !== undefined && !Array.isArray(labels)) return null;
  return {
    id,
    name,
    faces: faces.slice(0, MAX_PERSON_FACES),
    rejected: rejected.slice(0, MAX_PERSON_FACES),
    hidden,
    me: me ?? false,
    // A label this version doesn't know is dropped rather than refusing the person.
    labels: [...new Set((labels ?? []).filter(isPersonLabel))],
  };
}

function personMeta(person: Person): PersonMeta {
  const { name, faces, rejected, hidden, me, labels } = person;
  return { v: 1, name, faces, rejected, hidden, me, labels };
}

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function decode(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function remotePeopleStore(
  keys: SpaceKeys,
  makeApi: (token: string) => SpaceApi = spaceApi,
): PeopleStore {
  const loadCrypto = () => import('@twofold/crypto');
  let apiPromise: Promise<SpaceApi> | null = null;
  const remote = () =>
    (apiPromise ??= loadCrypto().then((crypto) => makeApi(crypto.spaceToken(keys))));

  const saveSegments = async (results: FaceResults) => {
    const crypto = await loadCrypto();
    const api = await remote();
    const ids: string[] = [];
    for (const part of splitResults(results, SEGMENT_BYTES)) {
      const id = await crypto.newRecordId();
      await api.putFaceSegment(id, await crypto.sealFaceSegment(keys, id, encodeSegment(part)));
      ids.push(id);
    }
    return ids;
  };

  return {
    load: async () => {
      const crypto = await loadCrypto();
      const api = await remote();
      const storedPeople = api.listPeople();
      storedPeople.catch(() => undefined);
      const results: FaceResults = new Map();
      const segments: string[] = [];
      let after: string | undefined;
      do {
        const page = await api.listFaceSegments(after);
        for (const stored of page.segments) {
          segments.push(stored.id);
          // A segment that doesn't open, or came from other models, is merged away later.
          const opened = await crypto
            .openFaceSegment(keys, stored.id, stored.data)
            .catch(() => null);
          const decoded = opened && decodeSegment(opened);
          if (!decoded) continue;
          for (const [photoId, faces] of decoded) results.set(photoId, faces);
        }
        after = page.next ?? undefined;
      } while (after);
      const people: Person[] = [];
      for (const stored of (await storedPeople).people) {
        const opened = await crypto
          .openOwnerRecord(keys, 'person', stored.id, stored.meta)
          .catch(() => null);
        const person = opened && parsePerson(stored.id, decode(opened));
        if (person) people.push(person);
      }
      return { results, people, segments };
    },

    saveResults: saveSegments,

    replaceSegments: async (results, old) => {
      const api = await remote();
      const ids = await saveSegments(results);
      for (let start = 0; start < old.length; start += FACE_SEGMENT_DELETE_MAX) {
        await api.deleteFaceSegments(old.slice(start, start + FACE_SEGMENT_DELETE_MAX));
      }
      return ids;
    },

    savePerson: async (person) => {
      const crypto = await loadCrypto();
      const api = await remote();
      const meta = await crypto.sealOwnerRecord(
        keys,
        'person',
        person.id,
        encode(personMeta(person)),
      );
      await api.putPerson(person.id, meta);
    },

    deletePerson: async (id) => {
      const api = await remote();
      await api.deletePerson(id);
    },

    forget: async () => {
      const api = await remote();
      await api.deleteFaceData();
    },

    newId: async () => (await loadCrypto()).newRecordId(),
  };
}

/** Keeps everything in memory: for rendering tests and previews. */
export function memoryPeopleStore(initial: Partial<SavedPeople> = {}): PeopleStore {
  let results: FaceResults = new Map(initial.results);
  const people = new Map((initial.people ?? []).map((person) => [person.id, person]));
  let next = 0;
  const newId = (prefix: string) => {
    next += 1;
    return `${prefix}-${String(next)}`;
  };
  return {
    load: () =>
      Promise.resolve({ results: new Map(results), people: [...people.values()], segments: [] }),
    saveResults: (added) => {
      for (const [photoId, faces] of added) results.set(photoId, faces);
      return Promise.resolve([newId('segment')]);
    },
    replaceSegments: (kept) => {
      results = new Map(kept);
      return Promise.resolve([newId('segment')]);
    },
    savePerson: (person) => {
      people.set(person.id, person);
      return Promise.resolve();
    },
    deletePerson: (id) => {
      people.delete(id);
      return Promise.resolve();
    },
    forget: () => {
      results = new Map();
      people.clear();
      return Promise.resolve();
    },
    newId: () => Promise.resolve(newId('person')),
  };
}
