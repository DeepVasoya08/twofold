import { describe, expect, it, vi } from 'vitest';

import {
  deleteFolder,
  deleteFolderForGood,
  moveToFolder,
  purgeFolders,
  renameFolder,
  restoreFolder,
} from './folder-changes';
import type { FolderSink, FolderStore } from './folder-changes';
import type { Folder, Photo } from './model';

function photo(id: string, albumIds: string[], extra: Partial<Photo> = {}): Photo {
  return {
    id,
    src: '',
    width: 0,
    height: 0,
    takenAt: '2026-11-01T00:00:00.000Z',
    addedBy: 'me',
    favorite: false,
    albumIds,
    ...extra,
  };
}

function fakeStore(overrides: Partial<FolderStore> = {}): FolderStore {
  return {
    saveFolder: vi.fn(() => Promise.resolve()),
    update: vi.fn(() => Promise.resolve()),
    trash: vi.fn((ids: readonly string[]) => Promise.resolve([...ids])),
    restore: vi.fn((ids: readonly string[]) => Promise.resolve([...ids])),
    remove: vi.fn(() => Promise.resolve()),
    removeAlbum: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function recorder(): FolderSink & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    saved: (folders) => log.push(`saved ${folders.map((f) => f.id).join(',')}`),
    moved: (ids, to) => log.push(`moved ${ids.join(',')} to ${String(to)}`),
    trashed: (ids) => log.push(`trashed ${ids.join(',')}`),
    restored: (ids) => log.push(`restored ${ids.join(',')}`),
    removed: (ids) => log.push(`removed ${ids.join(',')}`),
    gone: (ids) => log.push(`gone ${ids.join(',')}`),
  };
}

const folders: Folder[] = [
  { id: 'taxes', name: 'Taxes' },
  { id: 'receipts', name: 'Receipts', parentId: 'taxes' },
  { id: 'theirs', name: 'Theirs', library: 'Ana', viewOnly: true },
];

describe('folder changes', () => {
  it('renames with a checked name, and never a folder you can only view', async () => {
    const store = fakeStore();
    const sink = recorder();
    await renameFolder(store, folders, 'taxes', '  Tax  ', sink);
    expect(store.saveFolder).toHaveBeenCalledWith({ id: 'taxes', name: 'Tax' });
    await expect(renameFolder(store, folders, 'theirs', 'Mine', sink)).rejects.toThrow(/view/);
    await expect(renameFolder(store, folders, 'nope', 'X', sink)).rejects.toThrow(/isn’t here/);
  });

  it('moves files, saving only those that change', async () => {
    const store = fakeStore();
    const sink = recorder();
    const items = [photo('a', ['taxes']), photo('b', [])];
    const result = await moveToFolder(store, folders, items, ['a', 'b'], 'taxes', sink);
    expect(result.done).toEqual(['a', 'b']);
    expect(store.update).toHaveBeenCalledTimes(1);
    expect(sink.log).toEqual(['moved a,b to taxes']);
  });

  it('keeps files in their own library', async () => {
    const mixed: Folder[] = [...folders, { id: 'shared', name: 'Shared', library: 'Ana' }];
    const result = await moveToFolder(
      fakeStore(),
      mixed,
      [photo('a', [])],
      ['a'],
      'shared',
      recorder(),
    );
    expect(result.failed).toEqual(['a']);
  });

  it('deletes a folder with what is inside, files first', async () => {
    const store = fakeStore();
    const sink = recorder();
    const at = '2026-11-25T00:00:00.000Z';
    await deleteFolder(
      store,
      folders,
      [photo('a', ['receipts']), photo('b', [])],
      'taxes',
      sink,
      at,
    );
    expect(sink.log).toEqual(['trashed a', 'saved taxes,receipts']);
    expect(store.saveFolder).toHaveBeenCalledWith({ id: 'taxes', name: 'Taxes', deletedAt: at });
  });

  it('leaves the folder when its files couldn’t all go', async () => {
    const store = fakeStore({ trash: vi.fn(() => Promise.resolve([])) });
    const sink = recorder();
    await expect(
      deleteFolder(store, folders, [photo('a', ['taxes'])], 'taxes', sink),
    ).rejects.toThrow();
    expect(store.saveFolder).not.toHaveBeenCalled();
  });

  const at = '2026-11-20T00:00:00.000Z';
  const deleted: Folder[] = folders.map((folder) =>
    folder.library ? folder : { ...folder, deletedAt: at },
  );
  const trash = [
    photo('a', ['receipts'], { deletedAt: at }),
    photo('b', ['taxes'], { deletedAt: 'x' }),
  ];

  it('restores a folder with what was deleted along with it', async () => {
    const store = fakeStore();
    const sink = recorder();
    await restoreFolder(store, deleted, trash, 'taxes', sink);
    expect(sink.log).toEqual(['saved taxes,receipts', 'restored a']);
    expect(store.saveFolder).toHaveBeenCalledWith({ id: 'taxes', name: 'Taxes' });
  });

  it('deletes a folder for good after what was in it', async () => {
    const store = fakeStore();
    const sink = recorder();
    await deleteFolderForGood(store, deleted, trash, 'taxes', sink);
    expect(sink.log).toEqual(['removed a', 'gone taxes,receipts']);
  });

  it('purges only your own expired folders', async () => {
    const store = fakeStore();
    const sink = recorder();
    await purgeFolders(store, deleted, sink);
    expect(store.removeAlbum).toHaveBeenCalledTimes(2);
    expect(sink.log).toEqual(['gone taxes,receipts']);
  });
});
