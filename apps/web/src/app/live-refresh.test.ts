import { describe, expect, it } from 'vitest';

import type { Photo } from '@arcafold/core/library/model';

import { countingWrites } from './live-refresh';
import { memoryStore } from './memory-store';
import { vaultReducer } from './vault';
import type { VaultState } from './vault';

function photo(id: string, extra: Partial<Photo> = {}): Photo {
  return {
    id,
    src: '',
    width: 1,
    height: 1,
    takenAt: '2026-01-01T00:00:00Z',
    addedBy: 'me',
    favorite: false,
    albumIds: [],
    ...extra,
  };
}

describe('counting changes under way', () => {
  it('is busy while a change is under way, and not while it only reads', async () => {
    const { store, busy } = countingWrites(memoryStore({ photos: [photo('a')], albums: [] }));
    const listing = store.list();
    expect(busy()).toBe(false);
    await listing;
    const making = store.createAlbum('Trip');
    expect(busy()).toBe(true);
    await making;
    expect(busy()).toBe(false);
  });

  it('stops counting a change that fails', async () => {
    const { store, busy } = countingWrites(memoryStore({ photos: [], albums: [] }));
    await expect(store.shareFile('a')).rejects.toThrow();
    expect(busy()).toBe(false);
  });
});

describe('a refreshed listing', () => {
  const state: VaultState = {
    photos: [photo('a', { src: 'blob:a', fullSrc: 'blob:a-full' }), photo('gone')],
    albums: [],
    trash: [photo('old', { deletedAt: '2026-11-01T00:00:00Z' })],
  };

  it('takes what changed elsewhere, keeping images already shown and Recently deleted', () => {
    const next = vaultReducer(state, {
      type: 'refreshed',
      state: {
        photos: [photo('a', { favorite: true }), photo('new')],
        albums: [{ id: 'trip', title: 'Trip' }],
      },
    });
    expect(next.photos.map((each) => each.id).sort()).toEqual(['a', 'new']);
    expect(next.photos.find((each) => each.id === 'a')).toMatchObject({
      favorite: true,
      src: 'blob:a',
      fullSrc: 'blob:a-full',
    });
    expect(next.albums).toEqual([{ id: 'trip', title: 'Trip' }]);
    expect(next.trash?.map((each) => each.id)).toEqual(['old']);
  });
});
