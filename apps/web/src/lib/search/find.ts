/**
 * Answers a parsed search: people and dates filter the photos, and what's left of the
 * query ranks them by how well their vectors match it. CLIP's scores aren't percentages, so
 * one fixed threshold either shows junk or misses things; instead each score is compared
 * with how the rest of the library scores for the same query. The clear matches are "best";
 * the next tier is offered with "Show more".
 */
import type { PersonLabel } from '../people/grouping';
import type { ParsedQuery } from './query';
import { takenIn } from './query';
import type { SearchResults } from './segment';

/*
 * Tuned on 400 Flickr30k test photos with 30 everyday words ("dog", "beach", "snow") and a
 * caption for each photo. With these, the photo a caption describes is a best match 94% of
 * the time and always shown with "Show more"; for single words, about 6 photos are best
 * matches, 62% of them mentioned that word in their captions, and 83% of the photos that did
 * were shown with "Show more".
 */
/** Below this, a photo is never shown, however the rest of the library scores. */
export const SHOW_FLOOR = 0.17;
/** A best match scores at least this. */
export const BEST_FLOOR = 0.21;
/** How far above the library's average a best match, and a weaker one, stand. */
export const BEST_DEVIATIONS = 2.5;
export const MORE_DEVIATIONS = 1.2;
/** A best match is also this close to the top result. */
export const BEST_NEAR_TOP = 0.05;
/** With fewer photos than this, the spread says little, so only the floors count. */
export const FEW_PHOTOS = 20;

/** CLIP matches a short description best when it's worded like a caption. */
export function clipPrompt(what: string): string {
  return `a photo of ${what}`;
}

export interface Found {
  /** Clear matches, best first (or newest first when no words are left to rank by). */
  best: string[];
  /** Weaker matches, for "Show more". */
  more: string[];
  /** Photos that passed the filters but haven't been looked at yet, so can't be ranked. */
  notReady: number;
}

/** What People knows about each photo: who is in it. */
export interface PeopleIndex {
  /** Each photo's people: person ids for named ones, group ids for the rest. */
  inPhoto: ReadonlyMap<string, ReadonlySet<string>>;
  /** The person marked "This is me", if anyone is. */
  meId: string | null;
  labelsOf: ReadonlyMap<string, readonly PersonLabel[]>;
}

/** The dot product: vectors are length 1, so this is cosine similarity. */
export function similarity(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

/** The scores a best match and a weaker one need, given how the whole library scored. */
export function thresholds(library: readonly number[]): { bestAt: number; moreAt: number } {
  if (library.length < FEW_PHOTOS) return { bestAt: BEST_FLOOR, moreAt: SHOW_FLOOR };
  const mean = library.reduce((total, score) => total + score, 0) / library.length;
  const spread = Math.sqrt(
    library.reduce((total, score) => total + (score - mean) ** 2, 0) / library.length,
  );
  return {
    bestAt: Math.max(BEST_FLOOR, mean + BEST_DEVIATIONS * spread),
    moreAt: Math.max(SHOW_FLOOR, mean + MORE_DEVIATIONS * spread),
  };
}

/** Splits scored photos into best and more, against `library`'s scores (all of them). */
export function cutoff(
  scored: readonly { id: string; score: number }[],
  library: readonly number[] = scored.map((each) => each.score),
): { best: string[]; more: string[] } {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const { moreAt, ...floors } = thresholds(library);
  const bestAt = Math.max(floors.bestAt, (sorted[0]?.score ?? 0) - BEST_NEAR_TOP);
  const best = sorted.filter((each) => each.score >= bestAt).map((each) => each.id);
  const more = sorted
    .filter((each) => each.score < bestAt && each.score >= moreAt)
    .map((each) => each.id);
  return { best, more };
}

function passesPeople(query: ParsedQuery, photoId: string, people: PeopleIndex): boolean {
  const wantsPeople = query.me || query.us || query.people.length > 0 || query.labels.length > 0;
  if (!wantsPeople) return true;
  const inPhoto = people.inPhoto.get(photoId);
  if (!inPhoto) return false;
  if ((query.me || query.us) && (people.meId === null || !inPhoto.has(people.meId))) {
    return false;
  }
  if (query.us && ![...inPhoto].some((id) => id !== people.meId)) return false;
  if (!query.people.every((id) => inPhoto.has(id))) return false;
  return query.labels.every((label) =>
    [...inPhoto].some((id) => people.labelsOf.get(id)?.includes(label) === true),
  );
}

/**
 * Finds photos for a query. `photos` is the open space's photos, newest first. `vector` is
 * the query's words as a search vector, or null when no words are left after the filters.
 */
export function findPhotos({
  query,
  vector,
  photos,
  people,
  vectors,
}: {
  query: ParsedQuery;
  vector: Float32Array | null;
  photos: readonly { id: string; takenAt: string }[];
  people: PeopleIndex;
  vectors: SearchResults;
}): Found {
  const { when } = query;
  const passed = photos.filter(
    (photo) => (!when || takenIn(when, photo.takenAt)) && passesPeople(query, photo.id, people),
  );
  if (!vector) return { best: passed.map((photo) => photo.id), more: [], notReady: 0 };
  // How the whole library scores sets the bar, even when filters leave only a few photos.
  const scores = new Map<string, number>();
  for (const [id, found] of vectors) if (found) scores.set(id, similarity(vector, found));
  let notReady = 0;
  const scored: { id: string; score: number }[] = [];
  for (const photo of passed) {
    const score = scores.get(photo.id);
    if (score !== undefined) scored.push({ id: photo.id, score });
    // A photo whose preview couldn't be read (null) can't match words; it's not "not ready".
    else if (!vectors.has(photo.id)) notReady++;
  }
  return { ...cutoff(scored, [...scores.values()]), notReady };
}
