/**
 * Words taught to search: a name ("Biscuit") and a few photos that show it. Search then
 * finds photos that look like those, wherever the name is typed. What a word looks like is
 * the average of its photos' search vectors; it's kept with the word too, so the word still
 * works after its photos are deleted.
 */
import { fromBase64Url, toBase64Url } from '@twofold/crypto/webcrypto';

import { queryWords } from './query';
import { SEARCH_MODEL, VECTOR_LENGTH, packVector, unpackVector } from './segment';
import type { SearchResults } from './segment';

/** A word is taught with this many photos, at least and at most. */
export const MIN_EXAMPLES = 3;
export const MAX_EXAMPLES = 5;
/** Longest name, in characters. */
export const MAX_WORD_NAME = 40;

export interface TaughtWord {
  id: string;
  name: string;
  /** The photos it was taught with. */
  photos: string[];
  /** What it looks like, as saved; null if none of its photos had a vector yet. */
  vector: Float32Array | null;
}

interface WordMeta {
  v: 1;
  name: string;
  photos: string[];
  /** Which model made `vector`; a vector from another is ignored. */
  model?: number;
  /** A packed vector, base64url. */
  vector?: string;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function parseWord(id: string, value: unknown): TaughtWord | null {
  if (typeof value !== 'object' || value === null) return null;
  const { v, name, photos, model, vector } = value as Record<string, unknown>;
  if (v !== 1 || typeof name !== 'string' || name.trim() === '' || !isStringList(photos)) {
    return null;
  }
  const packed =
    model === SEARCH_MODEL && typeof vector === 'string' ? fromBase64Url(vector) : null;
  return {
    id,
    name,
    photos: photos.slice(0, MAX_EXAMPLES),
    vector: packed ? unpackVector(packed) : null,
  };
}

export function wordMeta(word: TaughtWord): WordMeta {
  const { name, photos, vector } = word;
  return vector
    ? { v: 1, name, photos, model: SEARCH_MODEL, vector: toBase64Url(packVector(vector)) }
    : { v: 1, name, photos };
}

/** The average of some vectors, at length 1; null with none. */
export function centroid(vectors: readonly Float32Array[]): Float32Array | null {
  if (vectors.length === 0) return null;
  const sum = new Float32Array(VECTOR_LENGTH);
  for (const vector of vectors) {
    for (let i = 0; i < VECTOR_LENGTH; i++) sum[i] = (sum[i] ?? 0) + (vector[i] ?? 0);
  }
  const length = Math.hypot(...sum);
  return length > 0 ? sum.map((v) => v / length) : null;
}

/** The vectors of the photos given, skipping any not looked at yet. */
export function vectorsOf(photoIds: readonly string[], results: SearchResults): Float32Array[] {
  return photoIds.flatMap((id) => {
    const vector = results.get(id);
    return vector ? [vector] : [];
  });
}

/**
 * What a word looks like now: its photos' average while they're all still here and looked
 * at, otherwise what was saved, otherwise whatever of its photos has been looked at.
 */
export function wordVector(word: TaughtWord, results: SearchResults): Float32Array | null {
  const found = vectorsOf(word.photos, results);
  if (found.length === word.photos.length) return centroid(found);
  return word.vector ?? centroid(found);
}

/**
 * Why `name` can't be a new word's name, or null if it can. A name that's already a
 * person's, or another word's, would make searches ambiguous.
 */
export function wordNameProblem(
  name: string,
  taken: { people: readonly string[]; words: readonly string[] },
): string | null {
  const words = queryWords(name);
  if (words.length === 0) return 'Type a name with at least one letter or number.';
  if (name.trim().length > MAX_WORD_NAME) {
    return `Keep it to ${String(MAX_WORD_NAME)} characters or fewer.`;
  }
  const key = words.join(' ');
  const same = (other: string) => queryWords(other).join(' ') === key;
  if (taken.people.some(same)) return 'Someone in People already has that name.';
  if (taken.words.some(same)) return 'You’ve already taught search that word.';
  return null;
}
