import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeHeif } from './heif';
import type * as Heif from './heif';
import { THUMB_MAX_SIDE, drawThumbnail, fitWithin } from './thumbnail';
import type { CanvasMaker } from './thumbnail';

vi.mock('./heif', async (importOriginal) => ({
  ...(await importOriginal<typeof Heif>()),
  decodeHeif: vi.fn(),
}));

const HEIC = readFileSync(join(import.meta.dirname, '../../e2e/fixtures/sample.heic'));

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

describe('drawThumbnail', () => {
  const sizes: number[][] = [];
  const canvas: CanvasMaker = (width, height) => {
    sizes.push([width, height]);
    return {
      draw: () => true,
      toJpeg: () => Promise.resolve(new Blob([new Uint8Array([7])])),
    };
  };

  /** A browser that can't read HEIC itself, but can draw decoded pixels. */
  function browserWithoutHeif() {
    class FakeImageData {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    }
    vi.stubGlobal('ImageData', FakeImageData);
    vi.stubGlobal('createImageBitmap', (source: unknown) =>
      source instanceof FakeImageData
        ? Promise.resolve({ width: source.width, height: source.height, close: vi.fn() })
        : Promise.reject(new Error('not an image')),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(decodeHeif).mockReset();
    sizes.length = 0;
  });

  it('decodes HEIC with libheif when the browser can’t', async () => {
    browserWithoutHeif();
    vi.mocked(decodeHeif).mockResolvedValue({
      data: new Uint8ClampedArray(4000 * 3000 * 4),
      width: 4000,
      height: 3000,
    });
    const thumb = await drawThumbnail(new Blob([HEIC], { type: 'image/heic' }), canvas);
    expect(thumb).toEqual({ bytes: new Uint8Array([7]), width: 4000, height: 3000 });
    expect(sizes).toEqual([[640, 480]]);
  });

  it('draws a bigger copy when asked', async () => {
    browserWithoutHeif();
    vi.mocked(decodeHeif).mockResolvedValue({
      data: new Uint8ClampedArray(4),
      width: 8000,
      height: 6000,
    });
    await drawThumbnail(new Blob([HEIC]), canvas, 4096);
    expect(sizes).toEqual([[4096, 3072]]);
  });

  it('only tries libheif on HEIC, and gives up when it can’t decode', async () => {
    browserWithoutHeif();
    expect(await drawThumbnail(new Blob([new Uint8Array(64)]), canvas)).toBeNull();
    expect(decodeHeif).not.toHaveBeenCalled();
    vi.mocked(decodeHeif).mockResolvedValue(null);
    expect(await drawThumbnail(new Blob([HEIC]), canvas)).toBeNull();
    vi.mocked(decodeHeif).mockRejectedValue(new Error('libheif failed to start'));
    expect(await drawThumbnail(new Blob([HEIC]), canvas)).toBeNull();
  });
});
