import { describe, expect, it, vi } from 'vitest';

import { canvasPicture } from './find-faces';
import type { DrawSurface } from './find-faces';

/** A 2D context that records what's done to it and returns blank pixels. */
function fakeContext() {
  const calls: unknown[][] = [];
  const context = {
    fillStyle: '',
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    fillRect: (...args: unknown[]) => calls.push(['fillRect', ...args]),
    drawImage: (...args: unknown[]) => calls.push(['drawImage', ...args.slice(1)]),
    setTransform: (...args: unknown[]) => calls.push(['setTransform', ...args]),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
  };
  const surface: DrawSurface = {
    getContext: () => context as unknown as OffscreenCanvasRenderingContext2D,
  };
  return { calls, context, surface };
}

const image = { width: 640, height: 480, close: vi.fn() } as unknown as ImageBitmap;

describe('canvasPicture', () => {
  it('draws the image through the transform onto black, at the size asked for', async () => {
    const { calls, context, surface } = fakeContext();
    const sizes: number[][] = [];
    const picture = canvasPicture(image, (width, height) => {
      sizes.push([width, height]);
      return surface;
    });
    expect([picture.width, picture.height]).toEqual([640, 480]);
    const pixels = await picture.draw(112, [0.5, 0.1, -0.1, 0.5, 3, 4]);
    expect(sizes).toEqual([[112, 112]]);
    expect(pixels).toHaveLength(112 * 112 * 4);
    expect(calls).toEqual([
      ['setTransform', 1, 0, 0, 1, 0, 0],
      ['fillRect', 0, 0, 112, 112],
      ['setTransform', 0.5, 0.1, -0.1, 0.5, 3, 4],
      ['drawImage', 0, 0],
    ]);
    expect(context.fillStyle).toBe('#000');
    expect(context.imageSmoothingQuality).toBe('low');
  });

  it('smooths as well as it can when asked', async () => {
    const { context, surface } = fakeContext();
    await canvasPicture(image, () => surface).draw(224, [0.5, 0, 0, 0.5, 0, 0], true);
    expect(context.imageSmoothingEnabled).toBe(true);
    expect(context.imageSmoothingQuality).toBe('high');
  });
});
