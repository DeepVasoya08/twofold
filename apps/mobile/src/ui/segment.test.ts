import { describe, expect, it } from 'vitest';

import { segment } from './segment';

describe('segment', () => {
  it('centres a level bar between its two ends', () => {
    const bar = segment(2, 10, 12, 10, 2, '#000');
    expect(bar.width).toBe(10);
    expect(bar.left).toBe(2);
    expect(bar.top).toBe(9);
    expect(bar.transform).toEqual([{ rotate: '0deg' }]);
  });

  it('turns a diagonal bar about its middle', () => {
    const bar = segment(0, 0, 6, 6, 2, '#000');
    const length = Math.hypot(6, 6);
    expect(bar.width).toBeCloseTo(length);
    expect(bar.left).toBeCloseTo(3 - length / 2);
    expect(bar.top).toBe(2);
    expect(bar.transform).toEqual([{ rotate: '45deg' }]);
  });
});
