import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@arcafold/core/api';
import { FormError } from '@arcafold/core/errors';
import type { NewPhoto } from '@arcafold/core/library/space-store';

import type { LibraryPhoto } from '../../modules/memory-image';
import { backUpNew } from './run-backup';
import type { BackupDeps } from './run-backup';

vi.mock('../../modules/memory-image', () => ({}));

const photo = (id: number, type = 'image/jpeg'): LibraryPhoto => ({
  id,
  uri: `content://media/${String(id)}`,
  name: `IMG_${String(id)}.jpg`,
  type,
  size: 10,
});

const prepared: NewPhoto = {
  thumb: new Uint8Array([1]),
  full: new Uint8Array([2]),
  type: 'image/jpeg',
  width: 1,
  height: 1,
  takenAt: '2026-11-16T09:00:00.000Z',
};

/** A phone with these photos on it, listed a few at a time. */
function phone(photos: LibraryPhoto[], overrides: Partial<BackupDeps> = {}) {
  const saved: number[] = [];
  const added: string[] = [];
  const deps: BackupDeps = {
    list: (afterId, limit) =>
      Promise.resolve(photos.filter((each) => each.id > afterId).slice(0, Math.min(limit, 2))),
    prepare: (each) =>
      each.type.startsWith('image/')
        ? Promise.resolve(prepared)
        : Promise.reject(new FormError('no')),
    add: () => {
      added.push('x');
      return Promise.resolve('id');
    },
    saveLastId: (id) => {
      saved.push(id);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { deps, saved, added };
}

describe('backUpNew', () => {
  it('backs up every photo after the last one, oldest first, remembering each', async () => {
    const { deps, saved } = phone([photo(3), photo(5), photo(8), photo(9)]);
    const result = await backUpNew(4, deps);
    expect(result).toEqual({ added: 3, skipped: 0, lastId: 9, error: null });
    expect(saved).toEqual([5, 8, 9]);
  });

  it('does nothing when there is nothing new', async () => {
    const { deps, saved } = phone([photo(3)]);
    expect(await backUpNew(3, deps)).toEqual({ added: 0, skipped: 0, lastId: 3, error: null });
    expect(saved).toEqual([]);
  });

  it('passes over what it can’t read or store, for good', async () => {
    const { deps, saved } = phone([photo(1), photo(2, 'video/mp4'), photo(3)], {
      add: vi
        .fn()
        .mockResolvedValueOnce('a')
        .mockRejectedValueOnce(new FormError('too large'))
        .mockResolvedValue('b'),
    });
    const result = await backUpNew(0, deps);
    expect(result).toEqual({ added: 1, skipped: 2, lastId: 3, error: null });
    expect(saved).toEqual([1, 2, 3]);
  });

  it('stops at a failure that isn’t the photo’s, and starts there next time', async () => {
    const offline = new ApiError(0, 'offline');
    const { deps, saved } = phone([photo(1), photo(2), photo(3)], {
      add: vi.fn().mockResolvedValueOnce('a').mockRejectedValueOnce(offline),
    });
    const result = await backUpNew(0, deps);
    expect(result).toEqual({ added: 1, skipped: 0, lastId: 1, error: offline });
    expect(saved).toEqual([1]);
  });

  it('stops between photos once turned off', async () => {
    let off = false;
    const { deps } = phone([photo(1), photo(2), photo(3)], {
      stopped: () => off,
      saveLastId: () => {
        off = true;
        return Promise.resolve();
      },
    });
    expect((await backUpNew(0, deps)).lastId).toBe(1);
  });
});
