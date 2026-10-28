/**
 * Answers a parsed search: people and dates filter the photos, and what's left of the
 * query ranks them by how well their vectors match it. CLIP's scores aren't percentages, so
 * one fixed threshold either shows junk or misses things; instead each score is compared
 * with how the rest of the library scores for the same query. The clear matches are "best";
 * the next tier is offered with "Show more".
 *
 * A search can also be for photos that look like others: one photo ("More like this") or a
 * taught word's photos. Photos score much higher against photos than against words, so
 * those comparisons have their own tuning. With words to rank by too, looking alike is a
 * filter, like a person's name.
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

export interface Tuning {
  showFloor: number;
  bestFloor: number;
  bestDeviations: number;
  moreDeviations: number;
  nearTop: number;
}

/** For ranking by words. */
export const WORDS_TUNING: Tuning = {
  showFloor: SHOW_FLOOR,
  bestFloor: BEST_FLOOR,
  bestDeviations: BEST_DEVIATIONS,
  moreDeviations: MORE_DEVIATIONS,
  nearTop: BEST_NEAR_TOP,
};

/*
 * Tuned on the same 400 photos, two photos counting as alike when their captions share an
 * everyday word: two photos score 0.34 on average (words and photos: about 0.2). Taught with
 * three photos, about 4 others are best matches, 2.6 times as often alike as chance would
 * give, and with "Show more" about half of the alike photos are shown. Real libraries, with
 * the same dog or room again and again, score alike photos higher than this.
 */
/** For ranking by how much photos look like others. */
export const LOOKS_TUNING: Tuning = {
  showFloor: 0.5,
  bestFloor: 0.6,
  bestDeviations: 2.5,
  moreDeviations: 1.5,
  nearTop: 0.15,
};

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
export function thresholds(
  library: readonly number[],
  tuning: Tuning = WORDS_TUNING,
): { bestAt: number; moreAt: number } {
  if (library.length < FEW_PHOTOS) return { bestAt: tuning.bestFloor, moreAt: tuning.showFloor };
  const mean = library.reduce((total, score) => total + score, 0) / library.length;
  const spread = Math.sqrt(
    library.reduce((total, score) => total + (score - mean) ** 2, 0) / library.length,
  );
  return {
    bestAt: Math.max(tuning.bestFloor, mean + tuning.bestDeviations * spread),
    moreAt: Math.max(tuning.showFloor, mean + tuning.moreDeviations * spread),
  };
}

/** Splits scored photos into best and more, against `library`'s scores (all of them). */
export function cutoff(
  scored: readonly { id: string; score: number }[],
  library: readonly number[] = scored.map((each) => each.score),
  tuning: Tuning = WORDS_TUNING,
): { best: string[]; more: string[] } {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const { moreAt, ...floors } = thresholds(library, tuning);
  const bestAt = Math.max(floors.bestAt, (sorted[0]?.score ?? 0) - tuning.nearTop);
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

/** Every looked-at photo's score against `vector`. */
function scoresFor(vector: Float32Array, vectors: SearchResults): Map<string, number> {
  const scores = new Map<string, number>();
  for (const [id, found] of vectors) if (found) scores.set(id, similarity(vector, found));
  return scores;
}

/**
 * Finds photos for a query. `photos` is the open space's photos, newest first. `vector` is
 * the query's words as a search vector, or null when no words are left after the filters.
 * `looksLike` holds what the photos must look like (a photo's vector, a taught word's), and
 * `exclude` photos never to show (the photo "More like this" started from).
 */
export function findPhotos({
  query,
  vector,
  looksLike = [],
  exclude = new Set(),
  photos,
  people,
  vectors,
}: {
  query: ParsedQuery;
  vector: Float32Array | null;
  looksLike?: readonly Float32Array[];
  exclude?: ReadonlySet<string>;
  photos: readonly { id: string; takenAt: string }[];
  people: PeopleIndex;
  vectors: SearchResults;
}): Found {
  const { when } = query;
  const passed = photos.filter(
    (photo) =>
      !exclude.has(photo.id) &&
      (!when || takenIn(when, photo.takenAt)) &&
      passesPeople(query, photo.id, people),
  );
  if (!vector && looksLike.length === 0) {
    return { best: passed.map((photo) => photo.id), more: [], notReady: 0 };
  }
  // How the whole library scores sets the bar, even when filters leave only a few photos.
  const looks = looksLike.map((look) => {
    const scores = scoresFor(look, vectors);
    return { scores, moreAt: thresholds([...scores.values()], LOOKS_TUNING).moreAt };
  });
  let notReady = 0;
  const alike: string[] = [];
  for (const photo of passed) {
    if (!vectors.has(photo.id)) notReady++;
    // A photo whose preview couldn't be read (null) can't match; it's not "not ready".
    else if (looks.every((look) => (look.scores.get(photo.id) ?? -1) >= look.moreAt)) {
      alike.push(photo.id);
    }
  }
  if (vector) {
    const scores = scoresFor(vector, vectors);
    const scored = alike.flatMap((id) => {
      const score = scores.get(id);
      return score === undefined ? [] : [{ id, score }];
    });
    return { ...cutoff(scored, [...scores.values()]), notReady };
  }
  // Ranked by how alike they look, on average.
  const average = (id: string) =>
    looks.reduce((total, look) => total + (look.scores.get(id) ?? 0), 0) / looks.length;
  const library = [...vectors.keys()].filter((id) => vectors.get(id)).map(average);
  const scored = alike.map((id) => ({ id, score: average(id) }));
  return { ...cutoff(scored, library, LOOKS_TUNING), notReady };
}
