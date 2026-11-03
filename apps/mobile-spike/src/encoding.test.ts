import { describe, expect, it } from 'vitest';

import { fromBase64, toBase64 } from './encoding';

describe('toBase64', () => {
  it('matches Node for short and long inputs', () => {
    for (const length of [0, 1, 2, 3, 100_000]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 7) & 255);
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('round-trips through fromBase64', () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => (i * 13) & 255);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});
