import { describe, expect, it } from 'vitest';

import {
  PHOTO_RECORD_MIN,
  decodeJson,
  encodeJson,
  encodePhotoMeta,
  hasPreview,
  parseAlbumMeta,
  parseFolderMeta,
  parsePhotoMeta,
} from './records';
import type { PhotoMeta } from './records';

const photo: PhotoMeta = {
  v: 1,
  key: 'k',
  type: 'image/jpeg',
  width: 4000,
  height: 3000,
  takenAt: '2026-11-03T10:00:00.000Z',
  favorite: false,
  albumIds: ['a1'],
};

const roundTrip = (meta: PhotoMeta) => parsePhotoMeta(decodeJson(encodePhotoMeta(meta)));

describe('encodePhotoMeta', () => {
  it('pads every record to the same minimum size, and the padding is ignored when read', () => {
    const bytes = encodePhotoMeta(photo);
    expect(bytes.length).toBe(PHOTO_RECORD_MIN);
    expect(roundTrip(photo)).toEqual(photo);
  });

  it('makes a file record the same size as a photo record', () => {
    const file: PhotoMeta = {
      ...photo,
      type: 'application/pdf',
      kind: 'file',
      name: 'Tax return 2025.pdf',
      bytes: 120_000,
      category: 'finance',
      words: ['tax', 'return'],
    };
    expect(encodePhotoMeta(file).length).toBe(encodePhotoMeta(photo).length);
    expect(roundTrip(file)).toEqual(file);
  });

  it("drops a file's words, last first, rather than grow past the minimum", () => {
    // A long name of 4-byte characters leaves no room for every word.
    const words = Array.from(
      { length: 16 },
      (_, i) => `w${String(i).padStart(2, '0')}${'x'.repeat(17)}`,
    );
    const file: PhotoMeta = {
      ...photo,
      type: 'text/plain',
      kind: 'file',
      name: `${'📄'.repeat(115)}.txt`,
      words,
    };
    const bytes = encodePhotoMeta(file);
    expect(bytes.length).toBe(PHOTO_RECORD_MIN);
    const kept = roundTrip(file)?.words ?? [];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(words.length);
    expect(kept).toEqual(words.slice(0, kept.length));
  });
});

describe('parsePhotoMeta', () => {
  it('keeps optional fields that are well formed', () => {
    const meta: PhotoMeta = {
      ...photo,
      by: { id: 'm1', name: 'Sam' },
      deletedAt: '2026-11-01T00:00:00.000Z',
      fp: 'print',
    };
    expect(roundTrip(meta)).toEqual(meta);
  });

  it.each([
    ['not an object', 'x'],
    ['another version', { ...photo, v: 2 }],
    ['a photo type that is not a photo', { ...photo, type: 'text/html' }],
    ['a bad date', { ...photo, takenAt: 'yesterday' }],
    ['a bad deletion date', { ...photo, deletedAt: 'soon' }],
    ['album ids that are not strings', { ...photo, albumIds: [1] }],
    ['a malformed added-by', { ...photo, by: { id: 1 } }],
    ['a file with no name', { ...photo, type: 'text/plain', kind: 'file' }],
    ['an unknown kind', { ...photo, kind: 'video' }],
  ])('refuses %s', (_label, value) => {
    expect(parsePhotoMeta(value)).toBeNull();
  });

  it('ignores file fields that are malformed instead of refusing the file', () => {
    const parsed = parsePhotoMeta({
      ...photo,
      type: 'text/plain',
      kind: 'file',
      name: 'a.txt',
      bytes: -1,
      category: 'not-a-category',
      sorted: 'them',
    });
    expect(parsed).toMatchObject({ kind: 'file', name: 'a.txt' });
    expect(parsed).not.toHaveProperty('bytes');
    expect(parsed).not.toHaveProperty('category');
    expect(parsed).not.toHaveProperty('sorted');
  });
});

describe('hasPreview', () => {
  it("is true for photos and for files with a drawn preview, not for a file's stand-in", () => {
    expect(hasPreview(photo)).toBe(true);
    const file: PhotoMeta = { ...photo, type: 'text/plain', kind: 'file', name: 'a.txt' };
    expect(hasPreview(file)).toBe(false);
    expect(hasPreview({ ...file, preview: true })).toBe(true);
  });
});

describe('parseAlbumMeta', () => {
  it('reads an album with and without a share key', () => {
    expect(parseAlbumMeta(decodeJson(encodeJson({ v: 1, title: 'Trip' })))).toEqual({
      v: 1,
      title: 'Trip',
    });
    expect(parseAlbumMeta({ v: 1, title: 'Trip', shareKey: 's' })).toEqual({
      v: 1,
      title: 'Trip',
      shareKey: 's',
    });
  });

  it('refuses a malformed album', () => {
    expect(parseAlbumMeta({ v: 1 })).toBeNull();
    expect(parseAlbumMeta({ v: 1, title: 'x', shareKey: 3 })).toBeNull();
  });
});

describe('decodeJson', () => {
  it('returns null for bytes that are not JSON', () => {
    expect(decodeJson(new Uint8Array([0xff, 0x00]))).toBeNull();
  });
});

describe('parseFolderMeta', () => {
  it('reads a folder, with where it is and when it was deleted', () => {
    const value = {
      v: 1,
      kind: 'folder',
      name: 'Taxes',
      parent: 'p1',
      deletedAt: '2026-11-01T00:00:00.000Z',
      shareKey: 'k',
    };
    expect(parseFolderMeta(decodeJson(encodeJson(value)))).toEqual(value);
    expect(parseFolderMeta({ v: 1, kind: 'folder', name: 'Top' })).toEqual({
      v: 1,
      kind: 'folder',
      name: 'Top',
    });
  });

  it.each([
    ['an album', { v: 1, title: 'Trip' }],
    ['no name', { v: 1, kind: 'folder', name: '' }],
    ['a long name', { v: 1, kind: 'folder', name: 'a'.repeat(101) }],
    ['a bad parent', { v: 1, kind: 'folder', name: 'A', parent: 3 }],
    ['a bad deletion date', { v: 1, kind: 'folder', name: 'A', deletedAt: 'soon' }],
    ['another version', { v: 2, kind: 'folder', name: 'A' }],
  ])('refuses %s', (_, value) => {
    expect(parseFolderMeta(value)).toBeNull();
  });

  it('is refused as an album, so older apps never list folders in Albums', () => {
    expect(parseAlbumMeta({ v: 1, kind: 'folder', name: 'Taxes' })).toBeNull();
  });
});
