import { describe, expect, it } from 'vitest';

import {
  canMoveFolder,
  changeableHere,
  childFolders,
  editableFile,
  expiredFolders,
  folderCounts,
  folderName,
  folderOf,
  folderPath,
  folderRestore,
  folderTrash,
  folderTree,
  foldersOfShare,
  inFiles,
  inTrashedFolder,
  itemsIn,
  liveFolders,
  trashedFolders,
  withFolder,
} from './folders';
import type { Folder, Photo } from './model';

const item = (id: string, albumIds: string[] = [], extra: Partial<Photo> = {}) => ({
  id,
  albumIds,
  ...extra,
});

const folders: Folder[] = [
  { id: 'taxes', name: 'Taxes 2025' },
  { id: 'receipts', name: 'Receipts', parentId: 'taxes' },
  { id: 'old', name: 'Old', parentId: 'receipts' },
  { id: 'car', name: 'car' },
  { id: 'home', name: 'Home 10' },
  { id: 'home2', name: 'Home 9' },
];

describe('folderName', () => {
  it('trims and squeezes spaces', () => {
    expect(folderName('  Tax   2025 ')).toBe('Tax 2025');
  });

  it('refuses an empty or too long name', () => {
    expect(() => folderName('   ')).toThrow(/name/);
    expect(() => folderName('a'.repeat(101))).toThrow(/100/);
    expect(folderName('📄'.repeat(100))).toHaveLength(200);
  });
});

describe('which folder', () => {
  const live = liveFolders(folders);

  it('finds the one folder an item is in, ignoring its albums', () => {
    expect(folderOf(item('a', ['album', 'receipts']), live)).toBe('receipts');
    expect(folderOf(item('b', ['album']), live)).toBeUndefined();
  });

  it('counts a deleted or missing folder as none, so the item shows at the top', () => {
    const someGone = liveFolders([{ id: 'x', name: 'X', deletedAt: '2026-11-01T00:00:00Z' }]);
    expect(folderOf(item('a', ['x']), someGone)).toBeUndefined();
    expect(itemsIn([item('a', ['x']), item('b', ['gone'])], [], null)).toHaveLength(2);
  });

  it('moves an item between folders and to the top, keeping its albums', () => {
    const moved = withFolder(item('a', ['album', 'taxes']), 'car', folders);
    expect(moved.albumIds).toEqual(['album', 'car']);
    expect(withFolder(moved, null, folders).albumIds).toEqual(['album']);
  });

  it('hands back the same item when nothing changes', () => {
    const same = item('a', ['car']);
    expect(withFolder(same, 'car', folders)).toBe(same);
    const top = item('b', ['album']);
    expect(withFolder(top, null, folders)).toBe(top);
  });
});

describe('the tree', () => {
  it('lists folders at a level by name, numbers in order', () => {
    expect(childFolders(folders, null).map((folder) => folder.name)).toEqual([
      'car',
      'Home 9',
      'Home 10',
      'Taxes 2025',
    ]);
    expect(childFolders(folders, 'taxes').map((folder) => folder.id)).toEqual(['receipts']);
  });

  it('shows a folder whose parent is gone at the top', () => {
    const orphan: Folder[] = [{ id: 'o', name: 'Orphan', parentId: 'nowhere' }];
    expect(childFolders(orphan, null)).toHaveLength(1);
  });

  it('gives the path from the top', () => {
    expect(folderPath(folders, 'old').map((folder) => folder.id)).toEqual([
      'taxes',
      'receipts',
      'old',
    ]);
    expect(folderPath(folders, 'nope')).toEqual([]);
  });

  it('stops rather than loops when folders name each other', () => {
    const loop: Folder[] = [
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
    ];
    expect(folderPath(loop, 'a').length).toBeLessThanOrEqual(2);
    expect(folderTree(loop, 'a')).toEqual(new Set(['a', 'b']));
  });

  it('never moves a folder into itself or below itself', () => {
    expect(canMoveFolder(folders, 'taxes', 'old')).toBe(false);
    expect(canMoveFolder(folders, 'taxes', 'taxes')).toBe(false);
    expect(canMoveFolder(folders, 'old', 'car')).toBe(true);
    expect(canMoveFolder(folders, 'old', null)).toBe(true);
  });

  it('keeps folders in their own library', () => {
    const mixed: Folder[] = [...folders, { id: 'theirs', name: 'Theirs', library: 'Ana' }];
    expect(canMoveFolder(mixed, 'car', 'theirs')).toBe(false);
  });

  it('counts what is directly inside', () => {
    const items = [item('a', ['taxes']), item('b', ['taxes']), item('c', ['receipts'])];
    expect(folderCounts(folders, items, 'taxes')).toEqual({ folders: 1, items: 2 });
  });
});

describe('deleting and restoring', () => {
  const at = '2026-11-20T10:00:00.000Z';
  const items = [item('a', ['taxes']), item('b', ['old']), item('c', ['car']), item('d')];

  it('takes the folders and items inside with it', () => {
    const plan = folderTrash(folders, items, 'taxes');
    expect(new Set(plan.folderIds)).toEqual(new Set(['taxes', 'receipts', 'old']));
    expect(plan.itemIds.sort()).toEqual(['a', 'b']);
  });

  const deleted = folders.map((folder) =>
    ['taxes', 'receipts', 'old'].includes(folder.id) ? { ...folder, deletedAt: at } : folder,
  );
  const trash = [
    item('a', ['taxes'], { deletedAt: at }),
    item('b', ['old'], { deletedAt: at }),
    // Deleted on its own, earlier: it stays deleted when the folder comes back.
    item('e', ['taxes'], { deletedAt: '2026-11-19T00:00:00.000Z' }),
  ];

  it('shows only the folder that was deleted, not those deleted along with it', () => {
    expect(trashedFolders(deleted).map((folder) => folder.id)).toEqual(['taxes']);
    expect(inTrashedFolder(trash[0] as Photo, deleted)).toBe(true);
    expect(inTrashedFolder(trash[2] as Photo, deleted)).toBe(false);
  });

  it('brings back what was deleted along with it, and nothing else', () => {
    const plan = folderRestore(deleted, trash, 'taxes');
    expect(new Set(plan.folderIds)).toEqual(new Set(['taxes', 'receipts', 'old']));
    expect(plan.itemIds.sort()).toEqual(['a', 'b']);
    expect(plan.moveToTop).toBe(false);
  });

  it('restores to the top when the folder it was in is gone', () => {
    const alone = deleted.map((folder) =>
      folder.id === 'old' ? { ...folder, deletedAt: '2026-11-21T00:00:00.000Z' } : folder,
    );
    // Old was deleted on its own later, inside the already deleted Receipts.
    expect(folderRestore(alone, [], 'old').moveToTop).toBe(true);
    expect(trashedFolders(alone).map((folder) => folder.id)).toEqual(['old', 'taxes']);
  });

  it('has nothing to restore for a folder that is not deleted', () => {
    expect(folderRestore(folders, trash, 'car')).toEqual({
      folderIds: [],
      itemIds: [],
      moveToTop: false,
    });
  });

  it('finds deleted folders whose 30 days are up', () => {
    const now = Date.parse('2026-12-25T00:00:00Z');
    expect(
      expiredFolders(deleted, now)
        .map((folder) => folder.id)
        .sort(),
    ).toEqual(['old', 'receipts', 'taxes']);
    expect(expiredFolders(deleted, Date.parse('2026-11-25T00:00:00Z'))).toEqual([]);
  });
});

describe('shared with you', () => {
  const shared: Folder[] = [
    ...folders,
    { id: 'lease', name: 'Lease', library: 'Alice', sharedFolder: true },
    { id: 'signed', name: 'Signed', library: 'Alice', sharedFolder: true, parentId: 'lease' },
    { id: 'look', name: 'Look', library: 'Sam', sharedFolder: true, viewOnly: true },
  ];

  it('keeps in Files your own files, files in shared folders and files shared on their own', () => {
    expect(inFiles(item('mine', ['taxes']), shared)).toBe(true);
    expect(inFiles(item('theirs', ['signed'], { sharedAlbum: true }), shared)).toBe(true);
    expect(inFiles(item('one', [], { sharedAlbum: true, sharedFile: true }), shared)).toBe(true);
    // Only in an album shared with you: that's for Albums.
    expect(inFiles(item('album', ['trip'], { sharedAlbum: true }), shared)).toBe(false);
  });

  it('lets you change your own files and those shared with you to edit', () => {
    expect(editableFile(item('mine', ['taxes']), shared)).toBe(true);
    expect(editableFile(item('theirs', ['signed'], { sharedAlbum: true }), shared)).toBe(true);
    expect(editableFile(item('one', [], { sharedAlbum: true, sharedFile: true }), shared)).toBe(
      true,
    );
    expect(
      editableFile(item('looked', ['look'], { sharedAlbum: true, viewOnly: true }), shared),
    ).toBe(false);
    expect(editableFile(item('album', ['trip'], { sharedAlbum: true }), shared)).toBe(false);
  });

  it('leaves a shared folder itself, and folders you may only view, to their owner', () => {
    const byId = new Map(shared.map((folder) => [folder.id, folder]));
    const changeable = (id: string) => {
      const folder = byId.get(id);
      if (!folder) throw new Error(id);
      return changeableHere(folder);
    };
    expect(changeable('taxes')).toBe(true);
    expect(changeable('signed')).toBe(true);
    expect(changeable('lease')).toBe(false);
    expect(changeable('look')).toBe(false);
  });
});

describe('what a share may show', () => {
  // Your own folders, as `taken` sees them.
  const yours = new Set(['medical', 'holiday']);
  const taken = (id: string) => yours.has(id);
  const ids = (list: readonly Folder[]) => list.map((folder) => folder.id);

  it('keeps a share’s own folders, inside each other in any order', () => {
    const listed: Folder[] = [
      { id: 'deep', name: 'Deep', parentId: 'inner' },
      { id: 'inner', name: 'Inner', parentId: 'from' },
      { id: 'from', name: 'From Alice' },
    ];
    expect(ids(foldersOfShare(listed, taken))).toEqual(['deep', 'inner', 'from']);
  });

  it('leaves out a folder with one of your ids, and anything listed inside it', () => {
    const listed: Folder[] = [
      { id: 'from', name: 'From Alice' },
      { id: 'medical', name: 'Medical', parentId: 'from' },
      { id: 'scans', name: 'Scans', parentId: 'medical' },
    ];
    expect(ids(foldersOfShare(listed, taken))).toEqual(['from']);
  });

  it('never puts a folder of theirs inside one of yours', () => {
    const listed: Folder[] = [
      { id: 'from', name: 'From Alice' },
      { id: 'trap', name: 'Upload here', parentId: 'medical' },
    ];
    expect(ids(foldersOfShare(listed, taken))).toEqual(['from']);
  });

  it('keeps a folder whose parent isn’t listed, which then shows at the top', () => {
    const listed: Folder[] = [{ id: 'orphan', name: 'Orphan', parentId: 'gone' }];
    expect(ids(foldersOfShare(listed, taken))).toEqual(['orphan']);
  });

  it('leaves out folders that name each other in a loop', () => {
    const listed: Folder[] = [
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'self', name: 'Self', parentId: 'self' },
    ];
    expect(foldersOfShare(listed, taken)).toEqual([]);
  });
});
