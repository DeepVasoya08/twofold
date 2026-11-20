import { describe, expect, it } from 'vitest';

import { faceCrop } from './edits';

describe('faceCrop', () => {
  it('centers the face in the square with room around it', () => {
    // A 100 px face in the middle of a 1000 px square photo.
    const crop = faceCrop(
      { x: 0.45, y: 0.45, width: 0.1, height: 0.1 },
      { width: 1000, height: 1000 },
    );
    expect(crop.width).toBeCloseTo(625);
    expect(crop.left).toBeCloseTo(-262.5);
    expect(crop.top).toBeCloseTo(-262.5);
  });

  it('uses the face’s larger side in pixels on a wide photo', () => {
    const crop = faceCrop({ x: 0, y: 0, width: 0.1, height: 0.2 }, { width: 2000, height: 1000 });
    // Both sides are 200 px; the square is 320 px.
    expect(crop.width).toBeCloseTo(625);
  });
});
