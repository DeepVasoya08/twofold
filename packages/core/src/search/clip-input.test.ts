import { describe, expect, it } from 'vitest';

import type { Transform } from '../picture';
import { CLIP_SIZE, centreSquare, clipInput, clipPlanes } from './clip-input';

describe('centreSquare', () => {
  it('takes the middle of a wide or tall photo', () => {
    expect(centreSquare(640, 480)).toEqual({ x: 80, y: 0, side: 480 });
    expect(centreSquare(480, 640)).toEqual({ x: 0, y: 80, side: 480 });
    expect(centreSquare(300, 300)).toEqual({ x: 0, y: 0, side: 300 });
  });
});

describe('clipPlanes', () => {
  it('splits RGB into planes, normalised the way CLIP was trained', () => {
    const pixels = CLIP_SIZE * CLIP_SIZE;
    const rgba = new Uint8ClampedArray(pixels * 4);
    // First pixel white, the rest black.
    rgba.set([255, 255, 255, 255]);
    const planes = clipPlanes(rgba);
    expect(planes).toHaveLength(3 * pixels);
    expect(planes[0]).toBeCloseTo((1 - 0.48145466) / 0.26862954, 5);
    expect(planes[pixels]).toBeCloseTo((1 - 0.4578275) / 0.26130258, 5);
    expect(planes[2 * pixels]).toBeCloseTo((1 - 0.40821073) / 0.27577711, 5);
    expect(planes[1]).toBeCloseTo(-0.48145466 / 0.26862954, 5);
  });

  it('refuses an image of the wrong size', () => {
    expect(() => clipPlanes(new Uint8ClampedArray(16))).toThrow();
  });
});

describe('clipInput', () => {
  it('draws the centred square at 224 × 224, smoothly', async () => {
    const draws: { size: number; transform: Transform; smooth: boolean | undefined }[] = [];
    const planes = await clipInput({
      width: 640,
      height: 480,
      draw: (size, transform, smooth) => {
        draws.push({ size, transform, smooth });
        return Promise.resolve(new Uint8Array(size * size * 4));
      },
    });
    const scale = CLIP_SIZE / 480;
    expect(draws).toEqual([
      { size: CLIP_SIZE, transform: [scale, 0, 0, scale, -80 * scale, -0], smooth: true },
    ]);
    expect(planes).toHaveLength(3 * CLIP_SIZE * CLIP_SIZE);
  });
});
