import { describe, expect, it } from 'vitest';

import type { Photo } from '../mock/data';
import { albumCover, albumPhotos, emptyVaults, vaultReducer } from './vault';
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

  it('deletes a photo and clears it as a cover', () => {
    const next = vaultReducer(state, { type: 'delete-photo', photoId: 'a' });
    expect(next.photos.map((p) => p.id)).toEqual(['b', 'c']);
    expect(next.albums[0]?.coverPhotoId).toBeUndefined();
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

describe('album helpers', () => {
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
