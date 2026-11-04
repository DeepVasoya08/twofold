import { describe, expect, it } from 'vitest';

import { photoId } from '../testing/faces';
import {
  SEARCH_MODEL,
  VECTOR_LENGTH,
  decodeSegment,
  encodeSegment,
  entryBytes,
  splitResults,
} from './segment';
import type { SearchResults } from './segment';

/** A made-up search vector of length 1, different for each seed. */
function vector(seed: number): Float32Array {
  const out = Float32Array.from({ length: VECTOR_LENGTH }, (_, i) => Math.sin(seed * 7 + i));
  const length = Math.hypot(...out);
  return out.map((v) => v / length);
}

const dot = (a: Float32Array, b: Float32Array) => a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);

describe('encodeSegment / decodeSegment', () => {
  it('round-trips vectors within 0.01 cosine, and photos with none', () => {
    const results: SearchResults = new Map([
      [photoId(1), vector(1)],
      [photoId(2), null],
      [photoId(3), vector(3)],
    ]);
    const decoded = decodeSegment(encodeSegment(results));
    expect(decoded && [...decoded.keys()]).toEqual([photoId(1), photoId(2), photoId(3)]);
    expect(decoded?.get(photoId(2))).toBeNull();
    const first = decoded?.get(photoId(1));
    if (!first) throw new Error('missing vector');
    expect(dot(first, vector(1))).toBeGreaterThan(0.99);
    expect(dot(first, first)).toBeCloseTo(1, 5);
  });

  it('stores half a kilobyte or so per photo', () => {
    expect(entryBytes(vector(1))).toBe(16 + 1 + 4 + VECTOR_LENGTH);
    expect(entryBytes(null)).toBe(17);
  });

  it('skips ids that are not record ids, and treats a wrong-sized vector as none', () => {
    const encoded = encodeSegment(
      new Map([
        ['short', vector(1)],
        [photoId(1), new Float32Array(3)],
      ]),
    );
    expect(decodeSegment(encoded)).toEqual(new Map([[photoId(1), null]]));
  });

  it('refuses other versions, other models, and cut or padded data', () => {
    const encoded = encodeSegment(new Map([[photoId(1), vector(1)]]));
    const changed = (index: number, value: number) => {
      const copy = encoded.slice();
      copy[index] = value;
      return copy;
    };
    expect(decodeSegment(changed(0, 0))).toBeNull();
    expect(decodeSegment(changed(2, 2))).toBeNull();
    expect(decodeSegment(changed(3, SEARCH_MODEL + 1))).toBeNull();
    // A face segment's header isn't a search segment.
    expect(decodeSegment(changed(1, 0x46))).toBeNull();
    expect(decodeSegment(changed(8 + 16, 2))).toBeNull();
    expect(decodeSegment(encoded.subarray(0, encoded.length - 1))).toBeNull();
    const padded = new Uint8Array(encoded.length + 1);
    padded.set(encoded);
    expect(decodeSegment(padded)).toBeNull();
    // An all-zero vector can't be a real one.
    const zero = encodeSegment(new Map([[photoId(1), new Float32Array(VECTOR_LENGTH)]]));
    expect(decodeSegment(zero)).toBeNull();
  });
});

describe('splitResults', () => {
  it('keeps every part under the limit, in order', () => {
    const results: SearchResults = new Map(
      Array.from({ length: 10 }, (_, n) => [photoId(n), n % 3 === 0 ? null : vector(n)]),
    );
    const limit = 8 + 3 * entryBytes(vector(0));
    const parts = splitResults(results, limit);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(encodeSegment(part).length).toBeLessThanOrEqual(limit);
    expect(parts.flatMap((part) => [...part.keys()])).toEqual([...results.keys()]);
  });
});
