import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { VIEW_MAX_SIDE, viewableCopy } from './thumbnail-service';

const HEIC = new Uint8Array(
  readFileSync(join(import.meta.dirname, '../../e2e/fixtures/sample.heic')),
);

describe('viewableCopy', () => {
  it('leaves formats every browser shows alone', async () => {
    const load = vi.fn();
    expect(await viewableCopy(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg', load)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('makes a JPEG copy of a HEIC photo the browser can’t show', async () => {
    // Node has no createImageBitmap, so this "browser" can't show HEIC.
    const thumbnailer = vi.fn(() =>
      Promise.resolve({ bytes: new Uint8Array([7]), width: 96, height: 64 }),
    );
    const copy = await viewableCopy(HEIC, 'image/heic', () => Promise.resolve(thumbnailer));
    expect(copy).toEqual(new Uint8Array([7]));
    expect(thumbnailer).toHaveBeenCalledWith(expect.any(Blob), VIEW_MAX_SIDE);

    thumbnailer.mockResolvedValueOnce(null as never);
    expect(await viewableCopy(HEIC, 'image/heic', () => Promise.resolve(thumbnailer))).toBeNull();
  });
});
