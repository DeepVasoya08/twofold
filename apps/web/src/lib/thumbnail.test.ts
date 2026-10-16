import { describe, expect, it } from 'vitest';

import { THUMB_MAX_SIDE, fitWithin } from './thumbnail';

describe('fitWithin', () => {
  it('scales the longer side down to the limit, keeping the shape', () => {
    expect(fitWithin(4000, 3000, THUMB_MAX_SIDE)).toEqual({ width: 640, height: 480 });
    expect(fitWithin(1000, 4000, 400)).toEqual({ width: 100, height: 400 });
  });

  it('never scales up or down to nothing', () => {
    expect(fitWithin(300, 200, 640)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(10_000, 1, 640)).toEqual({ width: 640, height: 1 });
  });
});
