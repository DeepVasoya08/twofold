import { describe, expect, it } from 'vitest';

import type { Photo } from '../mock/data';
import { albumCover, albumPhotos, vaultReducer } from './vault';
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

  it('adds uploads to the front, optionally into an album', () => {
    const next = vaultReducer(state, {
      type: 'add-photos',
      photos: [photo('d', '2026-04-01T00:00:00Z')],
      albumId: 'trip',
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
