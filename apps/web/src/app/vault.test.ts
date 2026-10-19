import { describe, expect, it } from 'vitest';

import type { Photo } from '../mock/data';
import {
  albumCover,
  albumPhotos,
  emptyVaults,
  fitsAlbum,
  timelinePhotos,
  vaultReducer,
  withDetails,
} from './vault';
import type { VaultState } from './vault';

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

  it('replaces everything once the space has loaded', () => {
    const loaded = { photos: [photo('z', '2026-05-01T00:00:00Z')], albums: [] };
    expect(vaultReducer(state, { type: 'loaded', state: loaded })).toBe(loaded);
  });

  it('starts a new session empty', () => {
    expect(emptyVaults.spaces.main.photos).toEqual([]);
    expect(emptyVaults.spaces.private.photos).toEqual([]);
  });
});
