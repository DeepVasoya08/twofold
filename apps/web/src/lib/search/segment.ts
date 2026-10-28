/**
 * The bytes of a search segment before it's sealed: for each photo looked at, its search
 * vector, or nothing for a photo whose preview couldn't be read (so it isn't looked at
 * again). Each vector is stored as 512 signed bytes and one scale, which keeps cosine
 * similarity within about 0.01 of the original.
 *
 *   header:  "TS" · version (1) · model (1) · photo count (u32)
 *   photo:   id (16 bytes) · has vector (u8) · [scale (f32) · 512 × i8]
 */
import { fromBase64Url, toBase64Url } from '@twofold/crypto/webcrypto';

/** Which model made the vectors. Vectors from any other are ignored and redone. */
export const SEARCH_MODEL = 1;
/** Numbers in a search vector (CLIP ViT-B/32). */
export const VECTOR_LENGTH = 512;

const VERSION = 1;
const HEADER_BYTES = 8;
const ID_BYTES = 16;

/** A photo's search vector (length 1), or null if its preview couldn't be read. */
export type SearchVector = Float32Array | null;

/** What each photo shows, keyed by the photo's id. */
export type SearchResults = Map<string, SearchVector>;

export function entryBytes(vector: SearchVector): number {
  return ID_BYTES + 1 + (vector ? 4 + VECTOR_LENGTH : 0);
}

/** Packs vectors for many photos. Photos whose id isn't a record id are skipped. */
export function encodeSegment(results: SearchResults): Uint8Array<ArrayBuffer> {
  const entries = [...results].flatMap(([id, vector]) => {
    const bytes = fromBase64Url(id);
    const usable = vector?.length === VECTOR_LENGTH ? vector : null;
    return bytes?.length === ID_BYTES ? [{ bytes, vector: usable }] : [];
  });
  const size = entries.reduce((total, entry) => total + entryBytes(entry.vector), 0);
  const out = new Uint8Array(HEADER_BYTES + size);
  const view = new DataView(out.buffer);
  out.set([0x54, 0x53, VERSION, SEARCH_MODEL]);
  view.setUint32(4, entries.length);
  let offset = HEADER_BYTES;
  for (const { bytes, vector } of entries) {
    out.set(bytes, offset);
    offset += ID_BYTES;
    out[offset] = vector ? 1 : 0;
    offset += 1;
    if (!vector) continue;
    let largest = 0;
    for (const v of vector) largest = Math.max(largest, Math.abs(v));
    const scale = largest > 0 ? largest / 127 : 1;
    view.setFloat32(offset, scale);
    for (let i = 0; i < VECTOR_LENGTH; i++) {
      view.setInt8(offset + 4 + i, Math.round((vector[i] ?? 0) / scale));
    }
    offset += 4 + VECTOR_LENGTH;
  }
  return out;
}

/**
 * Reads a segment. Returns null for a segment this version can't read, or one made by
 * another model, so its photos are looked at again.
 */
export function decodeSegment(bytes: Uint8Array): SearchResults | null {
  if (bytes.length < HEADER_BYTES || bytes[0] !== 0x54 || bytes[1] !== 0x53) return null;
  if (bytes[2] !== VERSION || bytes[3] !== SEARCH_MODEL) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(4);
  const results: SearchResults = new Map();
  let offset = HEADER_BYTES;
  for (let n = 0; n < count; n++) {
    if (offset + ID_BYTES + 1 > bytes.length) return null;
    const id = toBase64Url(bytes.subarray(offset, offset + ID_BYTES));
    const hasVector = bytes[offset + ID_BYTES];
    offset += ID_BYTES + 1;
    if (hasVector === 0) {
      results.set(id, null);
      continue;
    }
    if (hasVector !== 1 || offset + 4 + VECTOR_LENGTH > bytes.length) return null;
    const scale = view.getFloat32(offset);
    const vector = new Float32Array(VECTOR_LENGTH);
    let sum = 0;
    for (let i = 0; i < VECTOR_LENGTH; i++) {
      const v = view.getInt8(offset + 4 + i) * scale;
      vector[i] = v;
      sum += v * v;
    }
    const length = Math.sqrt(sum);
    if (!(length > 0)) return null;
    for (let i = 0; i < VECTOR_LENGTH; i++) vector[i] = (vector[i] ?? 0) / length;
    results.set(id, vector);
    offset += 4 + VECTOR_LENGTH;
  }
  return offset === bytes.length ? results : null;
}

/** Splits results into groups whose encoded size stays under `maxBytes` each. */
export function splitResults(results: SearchResults, maxBytes: number): SearchResults[] {
  const parts: SearchResults[] = [];
  let current: SearchResults = new Map();
  let size = HEADER_BYTES;
  for (const [id, vector] of results) {
    const bytes = entryBytes(vector);
    if (current.size > 0 && size + bytes > maxBytes) {
      parts.push(current);
      current = new Map();
      size = HEADER_BYTES;
    }
    current.set(id, vector);
    size += bytes;
  }
  if (current.size > 0) parts.push(current);
  return parts;
}
