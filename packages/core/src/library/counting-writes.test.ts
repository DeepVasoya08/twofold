import { describe, expect, it } from 'vitest';

import { countingWrites } from './counting-writes';
import type { SpaceStore } from './space-store';

/** Just enough of a store: one read, one change that waits for `finish`, one that fails. */
function store(finish: Promise<void>): SpaceStore {
  const partial: Partial<SpaceStore> = {
    list: () => Promise.resolve({ photos: [], albums: [], folders: [] }),
    createAlbum: async (title) => {
      await finish;
      return { id: 'a', title };
    },
    shareFile: () => Promise.reject(new Error('no')),
  };
  return partial as SpaceStore;
}

describe('counting changes under way', () => {
  it('is busy while a change is under way, and not while it only reads', async () => {
    let finish: () => void = () => undefined;
    const {
      store: counted,
      busy,
      started,
    } = countingWrites(
      store(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      ),
    );
    await counted.list();
    expect(busy()).toBe(false);
    expect(started()).toBe(0);
    const making = counted.createAlbum('Trip');
    expect(busy()).toBe(true);
    expect(started()).toBe(1);
    finish();
    await making;
    expect(busy()).toBe(false);
  });

  it('stops counting a change that fails', async () => {
    const { store: counted, busy } = countingWrites(store(Promise.resolve()));
    await expect(counted.shareFile('a')).rejects.toThrow();
    expect(busy()).toBe(false);
  });
});
