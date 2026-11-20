import { describe, expect, it } from 'vitest';

import { CLIP_SIZE, clipInput } from './clip-image';

describe('clipInput', () => {
  it('draws the centred square at 224 × 224 with smoothing on', async () => {
    const transforms: number[][] = [];
    const ctx = {
      fillStyle: '',
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      fillRect: () => undefined,
      setTransform: (...args: number[]) => transforms.push(args),
      drawImage: () => undefined,
      getImageData: () => ({ data: new Uint8ClampedArray(CLIP_SIZE * CLIP_SIZE * 4) }),
    };
    const sizes: number[][] = [];
    const planes = await clipInput({ width: 640, height: 480 } as ImageBitmap, (width, height) => {
      sizes.push([width, height]);
      return { getContext: () => ctx as unknown as OffscreenCanvasRenderingContext2D };
    });
    const scale = CLIP_SIZE / 480;
    expect(sizes).toEqual([[CLIP_SIZE, CLIP_SIZE]]);
    expect(transforms.at(-1)).toEqual([scale, 0, 0, scale, -80 * scale, -0]);
    expect(ctx.imageSmoothingEnabled).toBe(true);
    expect(ctx.imageSmoothingQuality).toBe('high');
    expect(planes).toHaveLength(3 * CLIP_SIZE * CLIP_SIZE);
  });
});
