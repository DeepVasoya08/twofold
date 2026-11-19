import { describe, expect, it } from 'vitest';

import {
  albumCover,
  albumPhotos,
  albumSharing,
  albumTitle,
  addsByUpload,
  albumsInTab,
  canChangeAlbum,
  canFillAlbum,
  copiesInto,
  fitsAlbum,
  isViewOnly,
  withAlbum,
} from './albums';
import type { Album, Photo } from './model';

function photo(id: string, takenAt: string, extra: Partial<Photo> = {}): Photo {
  return {
    id,
    src: '',
    width: 1,
    height: 1,
    takenAt,
    addedBy: 'me',
    favorite: false,
    albumIds: [],
    ...extra,
  };
}

const trip: Album = { id: 'trip', title: 'Trip' };

describe('withAlbum', () => {
  it('puts a photo in an album once', () => {
    const before = photo('a', '2026-01-01T00:00:00Z', { albumIds: ['x'] });
    const after = withAlbum(before, 'trip', true);
    expect(after.albumIds).toEqual(['x', 'trip']);
    expect(withAlbum(after, 'trip', true)).toBe(after);
  });

  it('takes a photo out, and leaves one that was never in it alone', () => {
    const before = photo('a', '2026-01-01T00:00:00Z', { albumIds: ['trip', 'x'] });
    expect(withAlbum(before, 'trip', false).albumIds).toEqual(['x']);
    const outside = photo('b', '2026-01-01T00:00:00Z');
    expect(withAlbum(outside, 'trip', false)).toBe(outside);
  });
});

describe('albumPhotos and albumCover', () => {
  const photos = [
    photo('old', '2025-01-01T00:00:00Z', { albumIds: ['trip'] }),
    photo('new', '2026-05-01T00:00:00Z', { albumIds: ['trip'] }),
    photo('elsewhere', '2026-06-01T00:00:00Z'),
    photo('deleted', '2026-07-01T00:00:00Z', {
      albumIds: ['trip'],
      deletedAt: '2026-07-02T00:00:00Z',
    }),
    photo('file', '2026-08-01T00:00:00Z', {
      albumIds: ['trip'],
      file: { name: 'a.pdf', type: 'application/pdf' },
    }),
  ];

  it('lists only the album’s photos, newest first, without files or deleted ones', () => {
    expect(albumPhotos(photos, 'trip').map((each) => each.id)).toEqual(['new', 'old']);
  });

  it('uses the chosen cover, else the newest photo', () => {
    expect(albumCover(photos, trip)?.id).toBe('new');
    expect(albumCover(photos, { ...trip, coverPhotoId: 'old' })?.id).toBe('old');
    expect(albumCover(photos, { ...trip, coverPhotoId: 'elsewhere' })?.id).toBe('new');
    expect(albumCover(photos, { id: 'empty', title: 'Empty' })).toBeUndefined();
  });
});

describe('who can change what', () => {
  it('treats shared albums and view-only libraries as view only', () => {
    expect(isViewOnly({})).toBe(false);
    expect(isViewOnly({ sharedAlbum: true })).toBe(true);
    expect(isViewOnly({ viewOnly: true })).toBe(true);
    expect(canChangeAlbum(trip)).toBe(true);
    expect(canChangeAlbum({ ...trip, library: 'Sam', sharedAlbum: true })).toBe(false);
    expect(canChangeAlbum({ ...trip, library: 'Sam' })).toBe(true);
  });

  it('lets photos into a shared album only if they let you add to it, by uploading', () => {
    const editable = { ...trip, library: 'Sam', sharedAlbum: true };
    const viewOnly = { ...editable, viewOnly: true };
    expect(canFillAlbum(trip)).toBe(true);
    expect(canFillAlbum(editable)).toBe(true);
    expect(canFillAlbum(viewOnly)).toBe(false);
    expect(canFillAlbum({ ...trip, library: 'Sam', viewOnly: true })).toBe(false);
    expect(addsByUpload(trip)).toBe(false);
    expect(addsByUpload(editable)).toBe(true);
    expect(addsByUpload(viewOnly)).toBe(false);
    // Renaming and deleting stay with its owner either way.
    expect(canChangeAlbum(editable)).toBe(false);
    const mine = photo('a', '2026-01-01T00:00:00Z');
    expect(copiesInto(mine, editable)).toBe(true);
    expect(copiesInto(mine, viewOnly)).toBe(false);
    expect(copiesInto(mine, trip)).toBe(false);
    expect(copiesInto({ ...mine, library: 'Sam' }, editable)).toBe(false);
  });

  it('only lets photos into albums of their own library', () => {
    const mine = photo('a', '2026-01-01T00:00:00Z');
    const theirs = photo('b', '2026-01-01T00:00:00Z', { library: 'Sam' });
    expect(fitsAlbum(mine, trip)).toBe(true);
    expect(fitsAlbum(theirs, trip)).toBe(false);
    expect(fitsAlbum(theirs, { ...trip, library: 'Sam' })).toBe(true);
    expect(fitsAlbum(theirs, { ...trip, library: 'Sam', viewOnly: true })).toBe(false);
    expect(fitsAlbum({ ...theirs, sharedAlbum: true }, { ...trip, library: 'Sam' })).toBe(false);
  });
});

describe('albumsInTab', () => {
  const albums: Album[] = [
    trip,
    { id: 'shared', title: 'Shared', sharedWith: ['Sam'] },
    { id: 'theirs', title: 'Theirs', library: 'Sam', sharedAlbum: true },
  ];
  it('splits albums by who shared them', () => {
    expect(albumsInTab(albums, 'all')).toHaveLength(3);
    expect(albumsInTab(albums, 'with-me').map((album) => album.id)).toEqual(['theirs']);
    expect(albumsInTab(albums, 'by-me').map((album) => album.id)).toEqual(['shared']);
  });
});

describe('albumTitle', () => {
  it('trims a name and refuses an empty or long one', () => {
    expect(albumTitle('  Goa 2026 ')).toEqual({ title: 'Goa 2026' });
    expect(albumTitle('   ')).toEqual({ error: 'Give your album a name.' });
    expect(albumTitle('x'.repeat(81))).toHaveProperty('error');
  });
});

describe('albumSharing', () => {
  it('says who shared an album, or who it is shared with', () => {
    expect(albumSharing(trip)).toBeNull();
    expect(albumSharing({ ...trip, sharedWith: ['Sam', 'Ana'] })).toBe('Shared with Sam, Ana');
    expect(albumSharing({ ...trip, library: 'Sam', sharedAlbum: true, viewOnly: true })).toBe(
      'Shared with you by Sam',
    );
    expect(albumSharing({ ...trip, library: 'Sam', sharedAlbum: true })).toBe(
      'Shared with you by Sam · you can add photos',
    );
    expect(albumSharing({ ...trip, library: 'Sam', viewOnly: true })).toBe(
      'From Sam’s library · view only',
    );
  });
});
