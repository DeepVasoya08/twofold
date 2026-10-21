import { describe, expect, it } from 'vitest';

import { cosine } from './sface';
import { decodeSegment, encodeSegment, entryBytes, splitResults } from './segment';
import type { FaceResults } from './segment';
import { face, photoId, unitVector } from './test-faces';

describe('encodeSegment / decodeSegment', () => {
  it('round-trips boxes and keeps fingerprints within 0.01 cosine', () => {
    const results: FaceResults = new Map([
      [photoId(1), [face(unitVector(1)), face(unitVector(2), 0.1)]],
      [photoId(2), []],
    ]);
    const decoded = decodeSegment(encodeSegment(results));
    expect(decoded && [...decoded.keys()]).toEqual([photoId(1), photoId(2)]);
    expect(decoded?.get(photoId(2))).toEqual([]);
    const faces = decoded?.get(photoId(1)) ?? [];
    expect(faces).toHaveLength(2);
    expect(faces[0]?.x).toBeCloseTo(0.2, 4);
    expect(faces[1]?.width).toBeCloseTo(0.1, 4);
    expect(faces[0]?.score).toBeCloseTo(0.9, 2);
    expect(cosine(faces[0]?.embedding ?? [], unitVector(1))).toBeGreaterThan(0.99);
    expect(cosine(faces[0]?.embedding ?? [], faces[0]?.embedding ?? [])).toBeCloseTo(1, 5);
  });

  it('skips photos whose id is not a record id', () => {
    const encoded = encodeSegment(new Map([['short', [face(unitVector(1))]]]));
    expect(decodeSegment(encoded)?.size).toBe(0);
  });

  it('refuses other versions, other models, and cut or padded data', () => {
    const encoded = encodeSegment(new Map([[photoId(1), [face(unitVector(1))]]]));
    const changed = (index: number, value: number) => {
      const copy = encoded.slice();
      copy[index] = value;
      return copy;
    };
    expect(decodeSegment(changed(0, 0))).toBeNull();
    expect(decodeSegment(changed(2, 2))).toBeNull();
    expect(decodeSegment(changed(3, 9))).toBeNull();
    expect(decodeSegment(encoded.subarray(0, encoded.length - 1))).toBeNull();
    expect(decodeSegment(new Uint8Array([...encoded, 0]))).toBeNull();
    expect(decodeSegment(new Uint8Array(3))).toBeNull();
  });
});

describe('splitResults', () => {
  it('keeps every part under the size asked for', () => {
    const results: FaceResults = new Map(
      Array.from({ length: 50 }, (_, n) => [photoId(n), [face(unitVector(n))]]),
    );
    const max = 8 + entryBytes(1) * 7;
    const parts = splitResults(results, max);
    expect(parts).toHaveLength(8);
    for (const part of parts) expect(encodeSegment(part).length).toBeLessThanOrEqual(max);
    expect(parts.reduce((total, part) => total + part.size, 0)).toBe(50);
  });
});
