import { describe, expect, it, vi } from 'vitest';

import { NOT_A_PHOTO, PREVIEW_MAX_SIDE, PREVIEW_QUALITY, preparePicked } from './prepare';
import type { PhotoReader } from './prepare';

const NOW = Date.UTC(2026, 10, 5, 12);

function reader(overrides: Partial<PhotoReader> = {}): PhotoReader {
  return {
    readAsync: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer)),
    previewAsync: vi.fn(() =>
      Promise.resolve({ thumb: new Uint8Array([9, 9]).buffer, width: 4000, height: 3000 }),
    ),
    ...overrides,
  };
}

const jpeg = { uri: 'content://media/1', name: 'IMG_1.jpg', type: 'image/jpeg', size: 4 };

describe('preparePicked', () => {
  it('keeps the original bytes and makes a web-sized preview', async () => {
    const read = reader();
    const photo = await preparePicked(jpeg, read, NOW);
    expect(Array.from(photo.full)).toEqual([1, 2, 3, 4]);
    expect(Array.from(photo.thumb)).toEqual([9, 9]);
    expect(photo).toMatchObject({ type: 'image/jpeg', width: 4000, height: 3000 });
    expect(read.previewAsync).toHaveBeenCalledWith(jpeg.uri, PREVIEW_MAX_SIDE, PREVIEW_QUALITY);
  });

  it('dates a photo without a capture date to now', async () => {
    const photo = await preparePicked(jpeg, reader(), NOW);
    expect(photo.takenAt).toBe(new Date(NOW).toISOString());
  });

  it('refuses something that isn’t a photo without reading it', async () => {
    const read = reader();
    await expect(
      preparePicked({ ...jpeg, name: 'notes.pdf', type: 'application/pdf' }, read, NOW),
    ).rejects.toThrow(NOT_A_PHOTO);
    expect(read.readAsync).not.toHaveBeenCalled();
  });

  it('says so plainly when the phone can’t decode the image', async () => {
    const read = reader({ previewAsync: () => Promise.reject(new Error('decode failed')) });
    await expect(preparePicked(jpeg, read, NOW)).rejects.toThrow('Arcafold can’t read this image.');
  });
});
