import { describe, expect, it, vi } from 'vitest';

import { newSpace, openRecord, ownerAccess } from '@twofold/crypto';

import type { Photo } from '../mock/data';
import { daysLeftLabel } from '../screens/RecentlyDeleted';
import { FakeServer } from '../test/fake-server';
import { combinedStore, memoryStore, remoteStore } from './space-store';
import type { NewPhoto } from './space-store';
import {
  TRASH_DAYS,
  loadTrash,
  trashDaysLeft,
  trashExpired,
  trashNote,
  vaultReducer,
} from './vault';
import type { VaultState } from './vault';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-30T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();

const PHOTO: NewPhoto = {
  thumb: new TextEncoder().encode('preview'),
  full: new TextEncoder().encode('original'),
  type: 'image/png',
  width: 10,
  height: 10,
  takenAt: '2026-10-16T09:30:00.000Z',
};

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

describe('how long a deleted photo has left', () => {
  it('counts down 30 days from the delete', () => {
    expect(TRASH_DAYS).toBe(30);
    expect(trashDaysLeft(daysAgo(0), NOW)).toBe(30);
    expect(trashDaysLeft(daysAgo(12.5), NOW)).toBe(18);
    expect(trashDaysLeft(daysAgo(29.9), NOW)).toBe(1);
    expect(trashDaysLeft(daysAgo(30), NOW)).toBe(0);
    expect(trashDaysLeft(daysAgo(45), NOW)).toBe(0);
  });

  it('is due only once the 30 days are up', () => {
    expect(trashExpired({ deletedAt: daysAgo(29.9) }, NOW)).toBe(false);
    expect(trashExpired({ deletedAt: daysAgo(30) }, NOW)).toBe(true);
    expect(trashExpired({}, NOW)).toBe(false);
  });

  it('labels each tile', () => {
    expect(daysLeftLabel({ deletedAt: daysAgo(2) }, NOW)).toBe('28 days left');
    expect(daysLeftLabel({ deletedAt: daysAgo(29.5) }, NOW)).toBe('Last day');
    expect(daysLeftLabel({}, NOW)).toBe('');
  });

  it('says how to get photos back', () => {
    expect(trashNote(1)).toBe('You can restore it from Recently deleted for 30 days.');
    expect(trashNote(3)).toBe('You can restore them from Recently deleted for 30 days.');
  });
});

describe('vaultReducer and Recently deleted', () => {
  const state: VaultState = {
    photos: [photo('a', { albumIds: ['trip'] }), photo('b')],
    albums: [{ id: 'trip', title: 'Trip', coverPhotoId: 'a' }],
    trash: [photo('old', { deletedAt: daysAgo(3) })],
  };

  it('moves deleted photos out of the library, newest deletion first', () => {
    const next = vaultReducer(state, {
      type: 'trash-photos',
      photoIds: ['a'],
      deletedAt: daysAgo(0),
    });
    expect(next.photos.map((p) => p.id)).toEqual(['b']);
    expect(next.trash?.map((p) => [p.id, p.deletedAt])).toEqual([
      ['a', daysAgo(0)],
      ['old', daysAgo(3)],
    ]);
    // It stops being the album's cover, but keeps its albums for when it comes back.
    expect(next.albums[0]).toEqual({ id: 'trip', title: 'Trip' });
    expect(next.trash?.[0]?.albumIds).toEqual(['trip']);
  });

  it('restores photos without their deletion date', () => {
    const next = vaultReducer(state, { type: 'restore-photos', photoIds: ['old'] });
    expect(next.trash).toEqual([]);
    expect(next.photos[0]).toEqual(photo('old'));
    expect(next.photos.map((p) => p.id)).toEqual(['old', 'a', 'b']);
  });

  it('deletes for good from Recently deleted', () => {
    const next = vaultReducer(state, { type: 'delete-photos', photoIds: ['old'] });
    expect(next.trash).toEqual([]);
    expect(next.photos).toEqual(state.photos);
  });

  it('shows previews in Recently deleted too', () => {
    const next = vaultReducer(state, { type: 'set-thumbs', urls: new Map([['old', 'blob:old']]) });
    expect(next.trash?.[0]?.src).toBe('blob:old');
  });

  it('keeps Recently deleted when an album is deleted', () => {
    const next = vaultReducer(state, { type: 'delete-album', albumId: 'trip' });
    expect(next.trash).toEqual(state.trash);
  });
});

describe('loading Recently deleted', () => {
  it('deletes for good what has been there 30 days, and keeps the rest', async () => {
    const trash = [
      photo('fresh', { deletedAt: daysAgo(1) }),
      photo('due', { deletedAt: daysAgo(31) }),
      photo('mid', { deletedAt: daysAgo(10) }),
    ];
    const remove = vi.fn(() => Promise.resolve());
    const done = vi.fn();
    await loadTrash({ listTrash: () => Promise.resolve(trash), remove }, () => false, done, NOW);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('due');
    expect(done).toHaveBeenCalledWith([trash[0], trash[2]]);
  });

  it('keeps a photo whose delete failed, for next time', async () => {
    const due = photo('due', { deletedAt: daysAgo(40) });
    const done = vi.fn();
    await loadTrash(
      {
        listTrash: () => Promise.resolve([due]),
        remove: () => Promise.reject(new Error('offline')),
      },
      () => false,
      done,
      NOW,
    );
    expect(done).toHaveBeenCalledWith([due]);
  });

  it('does nothing once the vault has closed, or when it can’t load', async () => {
    const remove = vi.fn(() => Promise.resolve());
    const done = vi.fn();
    const due = [photo('due', { deletedAt: daysAgo(40) })];
    await loadTrash({ listTrash: () => Promise.resolve(due), remove }, () => true, done, NOW);
    await loadTrash(
      { listTrash: () => Promise.reject(new Error('view only')), remove },
      () => false,
      done,
      NOW,
    );
    expect(remove).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });
});

describe('remoteStore and Recently deleted', () => {
  it('moves a photo out and back, sealing the deletion date where the server can’t read it', async () => {
    const server = new FakeServer();
    const space = await newSpace();
    const store = remoteStore(space, server.api);
    const kept = await store.add(PHOTO, []);
    const added = await store.add(PHOTO, ['album-1']);
    const deletedAt = daysAgo(0);

    expect(await store.trash([added.id, 'unknown'], deletedAt)).toEqual([added.id]);
    const entry = server.photos.get(added.id);
    expect(entry?.trashed).toBe(true);
    // The date is in the sealed record, nowhere else.
    const opened = await openRecord(
      await ownerAccess(space),
      'photo',
      added.id,
      entry?.photo.meta ?? '',
    );
    expect(JSON.parse(new TextDecoder().decode(opened))).toMatchObject({ deletedAt });

    const later = remoteStore(space, server.api);
    expect((await later.list()).photos.map((p) => p.id)).toEqual([kept.id]);
    const trash = await later.listTrash();
    expect(trash).toEqual([{ ...added, src: '', deletedAt }]);
    // A deleted photo's preview still downloads, to show it in Recently deleted.
    expect((await later.thumbs([added.id])).has(added.id)).toBe(true);

    expect(await later.restore([added.id])).toEqual([added.id]);
    expect(await later.listTrash()).toEqual([]);
    const listed = (await remoteStore(space, server.api).list()).photos;
    expect(listed.find((p) => p.id === added.id)).toEqual({ ...added, src: '' });
  });

  it('moves many photos in batches of 100', async () => {
    const server = new FakeServer();
    const batches: number[] = [];
    const api = (token: string) => {
      const real = server.api(token);
      return {
        ...real,
        trashPhotos: (photos: { id: string; meta: string }[]) => {
          batches.push(photos.length);
          return real.trashPhotos(photos);
        },
      };
    };
    const store = remoteStore(await newSpace(), api);
    const ids: string[] = [];
    for (let index = 0; index < 101; index += 1) ids.push((await store.add(PHOTO, [])).id);
    expect((await store.trash(ids, daysAgo(0))).sort()).toEqual([...ids].sort());
    expect(batches).toEqual([100, 1]);
    expect([...server.photos.values()].every((entry) => entry.trashed)).toBe(true);
  });
});

describe('combinedStore and Recently deleted', () => {
  it('shows libraries you can edit, and routes each restore to the photo’s own library', async () => {
    const theirsTrash = [photo('theirs', { deletedAt: daysAgo(1) })];
    const own = {
      ...memoryStore({ photos: [], albums: [] }),
      listTrash: () => Promise.resolve([photo('mine', { deletedAt: daysAgo(2) })]),
    };
    const restoredThere = vi.fn((ids: readonly string[]) => Promise.resolve([...ids]));
    const theirs = {
      ...memoryStore({ photos: [], albums: [] }),
      listTrash: () => Promise.resolve(theirsTrash),
      restore: restoredThere,
    };
    const viewOnly = {
      ...memoryStore({ photos: [], albums: [] }),
      listTrash: vi.fn(() => Promise.resolve([photo('hidden')])),
    };
    const store = combinedStore(own, () =>
      Promise.resolve([
        { id: 's', name: 'Ana', store: theirs },
        { id: 'v', name: 'Bo', store: viewOnly, editable: Promise.resolve(false) },
      ]),
    );
    await store.list();
    const trash = await store.listTrash();
    expect(trash.map((p) => [p.id, p.library])).toEqual([
      ['mine', undefined],
      ['theirs', 'Ana'],
    ]);
    expect(viewOnly.listTrash).not.toHaveBeenCalled();
    expect(await store.restore(['mine', 'theirs'])).toEqual(['mine', 'theirs']);
    expect(restoredThere).toHaveBeenCalledWith(['theirs']);
  });
});
