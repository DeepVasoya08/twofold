import { describe, expect, it } from 'vitest';

import {
  albumCover,
  albumFiles,
  allItems,
  albumPhotos,
  emptyVaults,
  fitsAlbum,
  isFile,
  timelinePhotos,
  vaultReducer,
  withDetails,
} from './vault';
import type { VaultState } from './vault';
import { foldersOf } from './vault';
import type { Photo } from '@arcafold/core/library/model';

function photo(id: string, takenAt: string, albumIds: string[] = []): Photo {
  return {
    id,
    src: '',
    width: 1,
    height: 1,
    takenAt,
    addedBy: 'me',
    favorite: false,
    albumIds,
  };
}

const state: VaultState = {
  photos: [
    photo('a', '2026-01-01T00:00:00Z', ['trip']),
    photo('b', '2026-03-01T00:00:00Z', ['trip']),
    photo('c', '2026-02-01T00:00:00Z'),
  ],
  albums: [{ id: 'trip', title: 'Trip', coverPhotoId: 'a' }],
};

describe('files in albums', () => {
  const booking: Photo = {
    ...photo('booking', '2026-02-10T00:00:00Z'),
    file: { name: 'booking.pdf', type: 'application/pdf' },
  };
  const withFile: VaultState = { ...state, files: [booking] };

  it('puts a file in an album and takes it out', () => {
    const added = vaultReducer(withFile, {
      type: 'set-details',
      photoIds: ['booking'],
      change: { albumId: 'trip', included: true },
    });
    expect(albumFiles(added, 'trip').map((item) => item.id)).toEqual(['booking']);
    // It's a file: the album's photos are unchanged.
    expect(added.photos).toEqual(withFile.photos);
    const removed = vaultReducer(added, {
      type: 'set-details',
      photoIds: ['booking'],
      change: { albumId: 'trip', included: false },
    });
    expect(albumFiles(removed, 'trip')).toEqual([]);
  });

  it('takes a deleted album out of its files', () => {
    const filed = { ...withFile, files: [{ ...booking, albumIds: ['trip'] }] };
    const next = vaultReducer(filed, { type: 'delete-album', albumId: 'trip' });
    expect(next.files?.[0]?.albumIds).toEqual([]);
  });

  it('lists an album’s files newest first', () => {
    const older = { ...booking, id: 'older', takenAt: '2026-01-01T00:00:00Z', albumIds: ['trip'] };
    const newer = { ...booking, id: 'newer', takenAt: '2026-03-01T00:00:00Z', albumIds: ['trip'] };
    const other = { ...booking, id: 'other', albumIds: [] };
    const listed = albumFiles({ ...state, files: [older, other, newer] }, 'trip');
    expect(listed.map((item) => item.id)).toEqual(['newer', 'older']);
  });
});

describe('vaultReducer', () => {
  it('toggles a favorite', () => {
    const next = vaultReducer(state, { type: 'toggle-favorite', photoId: 'c' });
    expect(next.photos.find((p) => p.id === 'c')?.favorite).toBe(true);
    expect(vaultReducer(next, { type: 'toggle-favorite', photoId: 'c' }).photos).toEqual(
      state.photos,
    );
  });

  it('deletes photos and clears them as covers', () => {
    const next = vaultReducer(state, { type: 'delete-photos', photoIds: ['a', 'c'] });
    expect(next.photos.map((p) => p.id)).toEqual(['b']);
    expect(next.albums[0]).toEqual({ id: 'trip', title: 'Trip' });
  });

  it('sets a favorite on many photos', () => {
    const next = vaultReducer(state, {
      type: 'set-details',
      photoIds: ['a', 'c'],
      change: { favorite: true },
    });
    expect(next.photos.map((p) => p.favorite)).toEqual([true, false, true]);
  });

  it('puts photos in an album and takes them out', () => {
    const added = vaultReducer(state, {
      type: 'set-details',
      photoIds: ['b', 'c'],
      change: { albumId: 'trip', included: true },
    });
    expect(added.photos.map((p) => p.albumIds)).toEqual([['trip'], ['trip'], ['trip']]);
    const removed = vaultReducer(added, {
      type: 'set-details',
      photoIds: ['a'],
      change: { albumId: 'trip', included: false },
    });
    expect(removed.photos.map((p) => p.albumIds)).toEqual([[], ['trip'], ['trip']]);
  });

  it('renames an album', () => {
    const next = vaultReducer(state, { type: 'rename-album', albumId: 'trip', title: 'Lisbon' });
    expect(next.albums).toEqual([{ id: 'trip', title: 'Lisbon', coverPhotoId: 'a' }]);
  });

  it('deletes an album and keeps its photos', () => {
    const next = vaultReducer(state, { type: 'delete-album', albumId: 'trip' });
    expect(next.albums).toEqual([]);
    expect(next.photos.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(next.photos.every((p) => p.albumIds.length === 0)).toBe(true);
  });

  it('adds uploads to the front', () => {
    const next = vaultReducer(state, {
      type: 'add-photos',
      photos: [photo('d', '2026-04-01T00:00:00Z', ['trip'])],
    });
    expect(next.photos[0]).toMatchObject({ id: 'd', albumIds: ['trip'] });
  });

  it('creates an album', () => {
    const next = vaultReducer(state, { type: 'create-album', album: { id: 'x', title: 'X' } });
    expect(next.albums.map((a) => a.id)).toEqual(['x', 'trip']);
  });
});

describe('withDetails', () => {
  it('returns the same photo when nothing changes', () => {
    const a = photo('a', '2026-01-01T00:00:00Z', ['trip']);
    expect(withDetails(a, { favorite: false })).toBe(a);
    expect(withDetails(a, { albumId: 'trip', included: true })).toBe(a);
    expect(withDetails(a, { albumId: 'other', included: false })).toBe(a);
  });

  it('adds an album after the ones it is in', () => {
    const a = photo('a', '2026-01-01T00:00:00Z', ['trip']);
    expect(withDetails(a, { albumId: 'other', included: true }).albumIds).toEqual([
      'trip',
      'other',
    ]);
  });
});

describe('album helpers', () => {
  it('only fits photos into albums of their own library', () => {
    const mine = photo('m', '2026-01-01T00:00:00Z');
    const theirs = { ...mine, library: 'Mira' };
    expect(fitsAlbum(mine, { id: 'x', title: 'X' })).toBe(true);
    expect(fitsAlbum(theirs, { id: 'x', title: 'X' })).toBe(false);
    expect(fitsAlbum(theirs, { id: 'y', title: 'Y', library: 'Mira' })).toBe(true);
    expect(fitsAlbum(mine, { id: 'y', title: 'Y', library: 'Mira' })).toBe(false);
  });

  it('never fits anything into or out of an album shared with you', () => {
    const theirs = { ...photo('t', '2026-01-01T00:00:00Z'), library: 'Mira' };
    const shared = { ...theirs, sharedAlbum: true };
    const sharedAlbum = { id: 's', title: 'S', library: 'Mira', sharedAlbum: true };
    expect(fitsAlbum(theirs, sharedAlbum)).toBe(false);
    expect(fitsAlbum(shared, sharedAlbum)).toBe(false);
    expect(fitsAlbum(shared, { id: 'y', title: 'Y', library: 'Mira' })).toBe(false);
  });

  it('keeps photos from albums shared with you out of the timeline', () => {
    const shared = { ...photo('s', '2026-04-01T00:00:00Z', ['x']), sharedAlbum: true };
    const withShared = { ...state, photos: [...state.photos, shared] };
    expect(timelinePhotos(withShared).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(albumPhotos(withShared, 'x').map((p) => p.id)).toEqual(['s']);
  });

  it('records who an album is shared with, and forgets it when nobody is left', () => {
    const shared = vaultReducer(state, {
      type: 'set-shared-with',
      albumId: 'trip',
      names: ['Mira'],
    });
    expect(shared.albums[0]?.sharedWith).toEqual(['Mira']);
    const cleared = vaultReducer(shared, { type: 'set-shared-with', albumId: 'trip', names: [] });
    expect(cleared.albums[0]).toEqual({ id: 'trip', title: 'Trip', coverPhotoId: 'a' });
  });

  it('lists album photos newest first', () => {
    expect(albumPhotos(state, 'trip').map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('uses the chosen cover, else the newest photo', () => {
    expect(albumCover(state, { id: 'trip', title: 'Trip', coverPhotoId: 'a' })?.id).toBe('a');
    expect(albumCover(state, { id: 'trip', title: 'Trip' })?.id).toBe('b');
    expect(albumCover(state, { id: 'none', title: 'None' })).toBeUndefined();
  });
});

describe('images', () => {
  it('sets a preview or an original as it is decrypted', () => {
    const withThumb = vaultReducer(state, {
      type: 'set-image',
      photoId: 'a',
      part: 'thumb',
      url: 'blob:thumb',
    });
    const withFull = vaultReducer(withThumb, {
      type: 'set-image',
      photoId: 'a',
      part: 'full',
      url: 'blob:full',
    });
    expect(withFull.photos[0]).toMatchObject({ id: 'a', src: 'blob:thumb', fullSrc: 'blob:full' });
    expect(withFull.photos[1]).toBe(state.photos[1]);
  });

  it('sets many previews in one update and leaves the other photos as they were', () => {
    const next = vaultReducer(state, {
      type: 'set-thumbs',
      urls: new Map([
        ['a', 'blob:a'],
        ['c', 'blob:c'],
      ]),
    });
    expect(next.photos.map((p) => p.src)).toEqual(['blob:a', '', 'blob:c']);
    expect(next.photos[1]).toBe(state.photos[1]);
  });

  it('keeps one decrypted original at a time', () => {
    const first = vaultReducer(state, {
      type: 'set-image',
      photoId: 'a',
      part: 'full',
      url: 'blob:a',
    });
    const second = vaultReducer(first, {
      type: 'set-image',
      photoId: 'b',
      part: 'full',
      url: 'blob:b',
    });
    expect(second.photos.map((p) => p.fullSrc)).toEqual([undefined, 'blob:b', undefined]);
  });

  it('keeps a viewable copy next to an original the browser can’t show', () => {
    const heic = vaultReducer(state, {
      type: 'set-image',
      photoId: 'a',
      part: 'full',
      url: 'blob:heic',
      viewUrl: 'blob:jpeg',
    });
    expect(heic.photos[0]).toMatchObject({ fullSrc: 'blob:heic', viewSrc: 'blob:jpeg' });
    const other = vaultReducer(heic, {
      type: 'set-image',
      photoId: 'b',
      part: 'full',
      url: 'blob:b',
    });
    expect(other.photos[0]?.viewSrc).toBeUndefined();
    expect(other.photos[0]?.fullSrc).toBeUndefined();
    expect(other.photos[1]?.viewSrc).toBeUndefined();
  });

  it('replaces everything once the space has loaded', () => {
    const loaded = { photos: [photo('z', '2026-05-01T00:00:00Z')], albums: [] };
    expect(vaultReducer(state, { type: 'loaded', state: loaded })).toEqual(loaded);
  });

  it('starts a new session empty', () => {
    expect(emptyVaults.spaces.main.photos).toEqual([]);
    expect(emptyVaults.spaces.private.photos).toEqual([]);
  });
});

describe('files', () => {
  const file = (id: string, takenAt: string): Photo => ({
    ...photo(id, takenAt),
    width: 0,
    height: 0,
    file: { name: `${id}.pdf`, type: 'application/pdf' },
  });
  const empty: VaultState = { photos: [], albums: [] };

  it('keeps files out of the photos when the space loads or uploads arrive', () => {
    const loaded = vaultReducer(empty, {
      type: 'loaded',
      state: {
        photos: [photo('a', '2026-01-01T00:00:00Z'), file('f', '2026-02-01T00:00:00Z')],
        albums: [],
      },
    });
    expect(loaded.photos.map((item) => item.id)).toEqual(['a']);
    expect(loaded.files?.map((item) => item.id)).toEqual(['f']);
    expect(allItems(loaded).map((item) => item.id)).toEqual(['a', 'f']);

    const added = vaultReducer(loaded, {
      type: 'add-photos',
      photos: [file('g', '2026-03-01T00:00:00Z'), photo('b', '2026-03-01T00:00:00Z')],
    });
    expect(added.photos.map((item) => item.id)).toEqual(['b', 'a']);
    expect(added.files?.map((item) => item.id)).toEqual(['g', 'f']);
  });

  it('moves files to Recently deleted and back to Files', () => {
    const start: VaultState = {
      photos: [photo('a', '2026-01-01T00:00:00Z')],
      files: [file('f', '2026-01-02T00:00:00Z')],
      albums: [],
    };
    const trashed = vaultReducer(start, {
      type: 'trash-photos',
      photoIds: ['f'],
      deletedAt: '2026-11-02T00:00:00Z',
    });
    expect(trashed.files).toEqual([]);
    expect(trashed.trash?.map((item) => item.id)).toEqual(['f']);
    const back = vaultReducer(trashed, { type: 'restore-photos', photoIds: ['f'] });
    expect(back.files?.map((item) => item.id)).toEqual(['f']);
    expect(back.photos.map((item) => item.id)).toEqual(['a']);
    expect(back.files?.[0]?.deletedAt).toBeUndefined();
    const gone = vaultReducer(back, { type: 'delete-photos', photoIds: ['f'] });
    expect(gone.files).toEqual([]);
  });

  it('leaves a space without files as it was', () => {
    const loaded = vaultReducer(empty, {
      type: 'loaded',
      state: { photos: [photo('a', '2026-01-01T00:00:00Z')], albums: [] },
    });
    expect(loaded.files).toBeUndefined();
    expect(isFile(file('f', '2026-01-01T00:00:00Z'))).toBe(true);
  });
});

describe('folders', () => {
  const taxes = { id: 'taxes', name: 'Taxes' };
  const car = { id: 'car', name: 'Car' };
  const bill: Photo = {
    ...photo('bill', '2026-11-01T00:00:00Z', ['album']),
    file: { name: 'bill.pdf', type: 'application/pdf' },
  };
  const start: VaultState = { photos: [], albums: [], files: [bill], folders: [taxes, car] };

  it('adds and changes folders in place', () => {
    const renamed = vaultReducer(start, {
      type: 'set-folders',
      folders: [
        { ...taxes, name: 'Tax' },
        { id: 'new', name: 'New' },
      ],
    });
    expect(foldersOf(renamed).map((folder) => folder.name)).toEqual(['Tax', 'Car', 'New']);
    const removed = vaultReducer(renamed, { type: 'remove-folders', folderIds: ['car'] });
    expect(foldersOf(removed).map((folder) => folder.id)).toEqual(['taxes', 'new']);
  });

  it('moves files between folders, keeping their albums', () => {
    const inTaxes = vaultReducer(start, {
      type: 'move-to-folder',
      itemIds: ['bill'],
      folderId: 'taxes',
    });
    expect(inTaxes.files?.[0]?.albumIds).toEqual(['album', 'taxes']);
    const inCar = vaultReducer(inTaxes, {
      type: 'move-to-folder',
      itemIds: ['bill'],
      folderId: 'car',
    });
    expect(inCar.files?.[0]?.albumIds).toEqual(['album', 'car']);
    const top = vaultReducer(inCar, { type: 'move-to-folder', itemIds: ['bill'], folderId: null });
    expect(top.files?.[0]?.albumIds).toEqual(['album']);
  });

  it('keeps loaded folders apart from albums', () => {
    const loaded = vaultReducer(
      { photos: [], albums: [] },
      { type: 'loaded', state: { photos: [bill], albums: [], folders: [taxes] } },
    );
    expect(loaded.folders).toEqual([taxes]);
    expect(loaded.albums).toEqual([]);
    expect(loaded.files).toEqual([bill]);
  });
});
