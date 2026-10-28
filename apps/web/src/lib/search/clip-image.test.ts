import { describe, expect, it } from 'vitest';

import { CLIP_SIZE, centreSquare, clipInput, clipPlanes } from './clip-image';

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
  it('draws the centred square at 224 × 224 with smoothing on', () => {
    const calls: number[][] = [];
    const ctx = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      drawImage: (...args: unknown[]) => {
        calls.push(args.slice(1).map(Number));
      },
      getImageData: () => ({ data: new Uint8ClampedArray(CLIP_SIZE * CLIP_SIZE * 4) }),
    };
    const sizes: number[][] = [];
    const planes = clipInput({ width: 640, height: 480 } as ImageBitmap, (width, height) => {
      sizes.push([width, height]);
      return { getContext: () => ctx as unknown as OffscreenCanvasRenderingContext2D };
    });
    expect(sizes).toEqual([[CLIP_SIZE, CLIP_SIZE]]);
    expect(calls).toEqual([[80, 0, 480, 480, 0, 0, CLIP_SIZE, CLIP_SIZE]]);
    expect(ctx.imageSmoothingEnabled).toBe(true);
    expect(ctx.imageSmoothingQuality).toBe('high');
    expect(planes).toHaveLength(3 * CLIP_SIZE * CLIP_SIZE);
  });
});
