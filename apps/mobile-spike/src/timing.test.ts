import { describe, expect, it } from 'vitest';

import { cosine, median } from './timing';

describe('median', () => {
  it('handles odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('cosine', () => {
  it('is 1 for the same direction and 0 for orthogonal vectors', () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  it('refuses vectors of different lengths', () => {
    expect(() => cosine([1], [1, 2])).toThrow();
  });
});
