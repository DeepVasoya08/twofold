import { describe, expect, it } from 'vitest';

import type { Photo } from '../mock/data';
import { albumCover, albumPhotos, spaceForPassword, vaultReducer, vaultsReducer } from './vault';
import type { VaultState, VaultsState } from './vault';

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

describe('spaces', () => {
  // Test-only phrases, not credentials.
  const privatePhrase = 'test-phrase-b';
  const mainPhrase = 'test-phrase-a';
  const vaults: VaultsState = {
    space: 'main',
    spaces: { main: state, private: { photos: [], albums: [{ id: 'p', title: 'P' }] } },
    privatePassword: privatePhrase,
  };

  it('opens the private space only with the private password', () => {
    expect(spaceForPassword(privatePhrase, privatePhrase)).toBe('private');
    expect(spaceForPassword(mainPhrase, privatePhrase)).toBe('main');
    expect(spaceForPassword(privatePhrase, null)).toBe('main');
    expect(spaceForPassword('', null)).toBe('main');
  });

  it('applies actions to the open space only', () => {
    const opened = vaultsReducer(vaults, { type: 'open-space', space: 'private' });
    const next = vaultsReducer(opened, {
      type: 'in-space',
      action: { type: 'create-album', album: { id: 'q', title: 'Q' } },
    });
    expect(next.spaces.private.albums.map((a) => a.id)).toEqual(['q', 'p']);
    expect(next.spaces.main).toBe(vaults.spaces.main);
  });

  it('moves a photo between spaces, leaving its albums behind', () => {
    const moved = vaultsReducer(vaults, { type: 'move-photo', photoId: 'a', to: 'private' });
    expect(moved.spaces.main.photos.map((p) => p.id)).toEqual(['b', 'c']);
    expect(moved.spaces.main.albums[0]?.coverPhotoId).toBeUndefined();
    expect(moved.spaces.private.photos).toMatchObject([{ id: 'a', albumIds: [] }]);

    const back = vaultsReducer(moved, { type: 'move-photo', photoId: 'a', to: 'main' });
    expect(back.spaces.private.photos).toEqual([]);
    expect(back.spaces.main.photos[0]?.id).toBe('a');
  });

  it('ignores a move of a photo that is not in the other space', () => {
    expect(vaultsReducer(vaults, { type: 'move-photo', photoId: 'a', to: 'main' })).toBe(vaults);
  });

  it('sets the private password', () => {
    const next = vaultsReducer(
      { ...vaults, privatePassword: null },
      { type: 'set-up-private', password: mainPhrase },
    );
    expect(next.privatePassword).toBe(mainPhrase);
  });
});
