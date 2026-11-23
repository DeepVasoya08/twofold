import { describe, expect, it, vi } from 'vitest';

import { STORAGE_SIZES } from '@arcafold/types';

import { isJpeg, PREVIEW_MIN_BYTES } from '@arcafold/core/file-types';

import {
  FILE_TOO_LARGE,
  PAGE_PREVIEW_SIDE,
  PREVIEW_MAX_SIDE,
  PREVIEW_QUALITY,
  preparePicked,
} from './prepare';
import type { PhotoReader } from './prepare';

const NOW = Date.UTC(2026, 10, 5, 12);

function reader(overrides: Partial<PhotoReader> = {}): PhotoReader {
  return {
    readAsync: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer)),
    previewAsync: vi.fn(() =>
      Promise.resolve({ thumb: new Uint8Array([9, 9]).buffer, width: 4000, height: 3000 }),
    ),
    pdfPreviewAsync: vi.fn(() => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 7]).buffer)),
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

  it('says so plainly when the phone can’t decode the image', async () => {
    const read = reader({ previewAsync: () => Promise.reject(new Error('decode failed')) });
    await expect(preparePicked(jpeg, read, NOW)).rejects.toThrow('Arcafold can’t read this image.');
  });
});

describe('preparePicked, for a file', () => {
  const pdf = {
    uri: 'content://docs/1',
    name: 'Lease.pdf',
    type: 'application/pdf',
    size: 4,
    modified: Date.UTC(2026, 3, 2),
  };

  it('keeps a PDF as a file, with its first page as a padded preview', async () => {
    const read = reader();
    const file = await preparePicked(pdf, read, NOW);
    expect(Array.from(file.full)).toEqual([1, 2, 3, 4]);
    expect(file.file).toEqual({ name: 'Lease.pdf', preview: true });
    expect(file.thumb).toHaveLength(PREVIEW_MIN_BYTES);
    expect(isJpeg(file.thumb)).toBe(true);
    expect(file).toMatchObject({ type: 'application/pdf', width: 0, height: 0 });
    expect(file.takenAt).toBe(new Date(pdf.modified).toISOString());
    expect(read.pdfPreviewAsync).toHaveBeenCalledWith(pdf.uri, PAGE_PREVIEW_SIDE, PREVIEW_QUALITY);
    expect(read.previewAsync).not.toHaveBeenCalled();
  });

  it('gives a PDF that can’t be drawn, or any other file, a stand-in preview', async () => {
    const broken = await preparePicked(
      pdf,
      reader({ pdfPreviewAsync: () => Promise.reject(new Error('protected')) }),
      NOW,
    );
    expect(broken.file).toEqual({ name: 'Lease.pdf' });
    expect(isJpeg(broken.thumb)).toBe(false);
    expect(broken.thumb.length).toBeGreaterThanOrEqual(PREVIEW_MIN_BYTES);

    const read = reader();
    const notes = await preparePicked(
      { ...pdf, name: 'notes.txt', type: 'text/plain', modified: 0 },
      read,
      NOW,
    );
    expect(notes.file).toEqual({ name: 'notes.txt' });
    expect(notes.takenAt).toBe(new Date(NOW).toISOString());
    expect(read.pdfPreviewAsync).not.toHaveBeenCalled();
  });

  it('cleans a file’s name and type', async () => {
    const file = await preparePicked(
      { ...pdf, name: 'a/b\u0001.docx', type: 'not a type' },
      reader(),
      NOW,
    );
    expect(file.file?.name).toBe('b.docx');
    expect(file.type).toBe('application/octet-stream');
  });

  it('turns down a file that’s too large without reading it', async () => {
    const read = reader();
    await expect(
      preparePicked({ ...pdf, size: STORAGE_SIZES.maxFull + 1 }, read, NOW),
    ).rejects.toThrow(FILE_TOO_LARGE);
    expect(read.readAsync).not.toHaveBeenCalled();
  });
});
