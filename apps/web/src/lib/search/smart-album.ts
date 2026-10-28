/**
 * Smart albums: searches saved as albums. One keeps what was typed, the parts tapped off,
 * the photo "More like this" started from, and when it was saved, so "last year" stays the
 * year it meant then. It also keeps the words' search vector, so opening it never needs the
 * text half. Each time it's opened, the search runs again over the photos looked at so far,
 * so it fills itself as new photos come in.
 */
import { fromBase64Url, toBase64Url } from '@twofold/crypto/webcrypto';

import { SEARCH_MODEL, packVector, unpackVector } from './segment';

/** Longest title, in characters. */
export const MAX_SMART_TITLE = 80;
/** Largest record before sealing: it must pad and seal within a record's size. */
export const MAX_SMART_BYTES = 1700;

export interface SmartAlbum {
  id: string;
  title: string;
  /** What was typed. */
  text: string;
  /** Keys of the chips tapped off. */
  ignore: string[];
  like: string | null;
  /** When it was saved (ISO 8601): dates like "last year" are read from then. */
  savedAt: string;
  /** What was left for CLIP when it was saved, and its vector. */
  what: string;
  vector: Float32Array | null;
}

interface SmartMeta {
  v: 1;
  title: string;
  text: string;
  ignore: string[];
  like: string | null;
  savedAt: string;
  what: string;
  /** Which model made `vector`; a vector from another is ignored. */
  model?: number;
  /** A packed vector, base64url. */
  vector?: string;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function parseSmartAlbum(id: string, value: unknown): SmartAlbum | null {
  if (typeof value !== 'object' || value === null) return null;
  const { v, title, text, ignore, like, savedAt, what, model, vector } = value as Record<
    string,
    unknown
  >;
  if (v !== 1 || typeof title !== 'string' || typeof text !== 'string') return null;
  if (!isStringList(ignore) || (like !== null && typeof like !== 'string')) return null;
  if (typeof savedAt !== 'string' || Number.isNaN(Date.parse(savedAt))) return null;
  if (typeof what !== 'string') return null;
  const packed =
    model === SEARCH_MODEL && typeof vector === 'string' ? fromBase64Url(vector) : null;
  return {
    id,
    title,
    text,
    ignore,
    like,
    savedAt,
    what,
    vector: packed ? unpackVector(packed) : null,
  };
}

export function smartMeta(album: SmartAlbum): SmartMeta {
  const { title, text, ignore, like, savedAt, what, vector } = album;
  const meta: SmartMeta = { v: 1, title, text, ignore, like, savedAt, what };
  return vector ? { ...meta, model: SEARCH_MODEL, vector: toBase64Url(packVector(vector)) } : meta;
}

/** Whether a smart album fits in one sealed record. */
export function smartAlbumFits(album: SmartAlbum): boolean {
  return new TextEncoder().encode(JSON.stringify(smartMeta(album))).length <= MAX_SMART_BYTES;
}

/** A title for a search, from what it was read as: "Estrella · Last year · beach". */
export function suggestTitle(chips: readonly { label: string }[]): string {
  const title = chips.map((chip) => chip.label).join(' · ');
  const first = title.charAt(0).toUpperCase() + title.slice(1);
  return first.length > MAX_SMART_TITLE ? `${first.slice(0, MAX_SMART_TITLE - 1)}…` : first;
}
