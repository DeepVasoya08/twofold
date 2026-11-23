import { describe, expect, it } from 'vitest';

import { contrastRatio } from './contrast';

describe('contrastRatio', () => {
  it('is 21 for black on white, in either order', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5);
  });

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio('#2f4bf0', '#2f4bf0')).toBe(1);
  });

  it('matches a known pair', () => {
    // #767676 on white is the classic 4.54:1.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('rejects anything that is not a hex colour', () => {
    expect(() => contrastRatio('blue', '#fff')).toThrow('Not a hex colour');
    expect(() => contrastRatio('#12345', '#fff')).toThrow();
  });
});
