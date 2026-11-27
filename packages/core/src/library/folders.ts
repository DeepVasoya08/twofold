/**
 * Folders in Files, as both apps use them: which folder a file is in, what a folder holds,
 * the path down to one, where a folder may move, and what deleting or restoring one takes
 * with it. Pure functions over decrypted folders and items.
 *
 * A folder is stored as an album record, and an item is in a folder when its `albumIds`
 * name it (so the server learns nothing new). An item is in one folder at most; a folder
 * that is missing or in Recently deleted doesn't count, so its files show at the top.
 */
import { FormError } from '../errors';
import { MAX_FOLDER_NAME } from '../records';
import { trashExpired } from './trash';
import type { Folder, Photo } from './model';

/** A folder's name as it is kept: trimmed, and checked to be there and not too long. */
export function folderName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) throw new FormError('Give the folder a name.');
  if (Array.from(trimmed).length > MAX_FOLDER_NAME) {
    throw new FormError(`Folder names can be up to ${String(MAX_FOLDER_NAME)} characters.`);
  }
  return trimmed;
}

/** Folders that aren't in Recently deleted, by id. */
export function liveFolders(folders: readonly Folder[]): Map<string, Folder> {
  return new Map(
    folders.filter((folder) => folder.deletedAt === undefined).map((folder) => [folder.id, folder]),
  );
}

/** The folder an item is in, if it is in one that is still here. */
export function folderOf(
  item: Pick<Photo, 'albumIds'>,
  live: ReadonlyMap<string, Folder>,
): string | undefined {
  return item.albumIds.find((id) => live.has(id));
}

/**
 * The item moved into `folderId` (or to the top of Files, for null), out of any folder it
 * was in. Its albums stay. The same item comes back when that changes nothing.
 */
export function withFolder<T extends Pick<Photo, 'albumIds'>>(
  item: T,
  folderId: string | null,
  folders: readonly Folder[],
): T {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const others = item.albumIds.filter((id) => !folderIds.has(id));
  const albumIds = folderId === null ? others : [...others, folderId];
  const same =
    albumIds.length === item.albumIds.length && albumIds.every((id) => item.albumIds.includes(id));
  return same ? item : { ...item, albumIds };
}

/** The folder a folder is in, if that one is still here: otherwise it shows at the top. */
export function parentOf(folder: Folder, live: ReadonlyMap<string, Folder>): string | undefined {
  return folder.parentId !== undefined && live.has(folder.parentId) ? folder.parentId : undefined;
}

const byName = (a: Folder, b: Folder) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** The folders directly inside `parentId` (or at the top, for null), by name. */
export function childFolders(folders: readonly Folder[], parentId: string | null): Folder[] {
  const live = liveFolders(folders);
  return [...live.values()]
    .filter((folder) => (parentOf(folder, live) ?? null) === parentId)
    .sort(byName);
}

/** The items directly inside `folderId` (or at the top of Files, for null). */
export function itemsIn<T extends Pick<Photo, 'albumIds'>>(
  items: readonly T[],
  folders: readonly Folder[],
  folderId: string | null,
): T[] {
  const live = liveFolders(folders);
  return items.filter((item) => (folderOf(item, live) ?? null) === folderId);
}

/**
 * The folders from the top of Files down to `folderId`, ending with it. Empty when it isn't
 * here. Stops rather than loops if folders somehow name each other.
 */
export function folderPath(folders: readonly Folder[], folderId: string): Folder[] {
  const live = liveFolders(folders);
  const path: Folder[] = [];
  const seen = new Set<string>();
  let current = live.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    const parent = parentOf(current, live);
    current = parent === undefined ? undefined : live.get(parent);
  }
  return path;
}

/**
 * The folders a share may show you: none whose id is already taken (one of yours, or one
 * another share showed first), and none inside a folder that was left out, so nothing a share
 * lists can sit inside one of your folders. A folder whose parent isn't listed at all shows at
 * the top, as anywhere else, unless that parent's id is taken. Folders naming each other in a
 * loop are left out.
 */
export function foldersOfShare(
  folders: readonly Folder[],
  taken: (id: string) => boolean,
): Folder[] {
  const listed = new Set(folders.map((folder) => folder.id));
  const kept = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (kept.has(folder.id) || taken(folder.id)) continue;
      const parent = folder.parentId;
      const placed =
        parent === undefined || (listed.has(parent) ? kept.has(parent) : !taken(parent));
      if (placed) {
        kept.add(folder.id);
        grew = true;
      }
    }
  }
  return folders.filter((folder) => kept.has(folder.id));
}

/** `folderId` and every folder inside it, however deep, among `folders`. */
export function folderTree(folders: readonly Folder[], folderId: string): Set<string> {
  const tree = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId !== undefined && tree.has(folder.parentId) && !tree.has(folder.id)) {
        tree.add(folder.id);
        grew = true;
      }
    }
  }
  return tree;
}

/**
 * Whether a folder may move into `parentId` (or to the top, for null): not into itself or
 * any folder inside it, and only somewhere in its own library.
 */
export function canMoveFolder(
  folders: readonly Folder[],
  folderId: string,
  parentId: string | null,
): boolean {
  if (parentId === null) return true;
  const live = liveFolders(folders);
  const folder = live.get(folderId);
  const parent = live.get(parentId);
  if (!folder || !parent || folder.library !== parent.library) return false;
  return !folderTree(folders, folderId).has(parentId);
}

/** How many folders and items are directly inside a folder. */
export function folderCounts(
  folders: readonly Folder[],
  items: readonly Pick<Photo, 'albumIds'>[],
  folderId: string,
): { folders: number; items: number } {
  return {
    folders: childFolders(folders, folderId).length,
    items: itemsIn(items, folders, folderId).length,
  };
}

/** What deleting a folder moves to Recently deleted: it, the folders in it, and their items. */
export interface FolderTrash {
  folderIds: string[];
  itemIds: string[];
}

/** What deleting `folderId` takes with it: the live folders under it and their items. */
export function folderTrash(
  folders: readonly Folder[],
  items: readonly Pick<Photo, 'id' | 'albumIds'>[],
  folderId: string,
): FolderTrash {
  const live = liveFolders(folders);
  const tree = folderTree([...live.values()], folderId);
  const folderIds = [...tree].filter((id) => live.has(id));
  const itemIds = items
    .filter((item) => {
      const folder = folderOf(item, live);
      return folder !== undefined && tree.has(folder);
    })
    .map((item) => item.id);
  return { folderIds, itemIds };
}

/**
 * Folders shown on their own in Recently deleted: deleted ones that weren't deleted along
 * with the folder they're in. Newest deletion first.
 */
export function trashedFolders(folders: readonly Folder[]): Folder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  return folders
    .filter((folder) => {
      if (folder.deletedAt === undefined) return false;
      const parent = folder.parentId === undefined ? undefined : byId.get(folder.parentId);
      return parent?.deletedAt !== folder.deletedAt;
    })
    .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
}

/**
 * What restoring a deleted folder brings back: it, the folders deleted along with it, and the
 * items deleted along with those. Items and folders deleted on their own, before or after,
 * stay where they are. `moveToTop` is set when the folder it was in is gone or deleted.
 */
export function folderRestore(
  folders: readonly Folder[],
  trash: readonly Pick<Photo, 'id' | 'albumIds' | 'deletedAt'>[],
  folderId: string,
): FolderTrash & { moveToTop: boolean } {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const folder = byId.get(folderId);
  if (folder?.deletedAt === undefined) return { folderIds: [], itemIds: [], moveToTop: false };
  const together = folders.filter((each) => each.deletedAt === folder.deletedAt);
  const tree = folderTree(together, folderId);
  const itemIds = trash
    .filter(
      (item) => item.deletedAt === folder.deletedAt && item.albumIds.some((id) => tree.has(id)),
    )
    .map((item) => item.id);
  const parent = folder.parentId === undefined ? undefined : byId.get(folder.parentId);
  const moveToTop =
    folder.parentId !== undefined && (parent === undefined || parent.deletedAt !== undefined);
  return { folderIds: [...tree], itemIds, moveToTop };
}

/**
 * Items deleted along with a folder that is still in Recently deleted: they show inside it
 * there rather than on their own.
 */
export function inTrashedFolder(
  item: Pick<Photo, 'albumIds' | 'deletedAt'>,
  folders: readonly Folder[],
): boolean {
  return folders.some(
    (folder) =>
      folder.deletedAt !== undefined &&
      folder.deletedAt === item.deletedAt &&
      item.albumIds.includes(folder.id),
  );
}

/** Deleted folders whose 30 days are up, to delete for good. */
export function expiredFolders(folders: readonly Folder[], now = Date.now()): Folder[] {
  return folders.filter((folder) => trashExpired(folder, now));
}

type SharedItem = Pick<Photo, 'albumIds' | 'sharedAlbum' | 'sharedFile' | 'viewOnly'>;

/** Whether `item` is in a folder someone shared with you (or one inside it). */
function inSharedFolder(item: SharedItem, folders: readonly Folder[]): boolean {
  const shared = new Set(folders.filter((folder) => folder.sharedFolder).map((f) => f.id));
  return item.albumIds.some((id) => shared.has(id));
}

/**
 * Whether an item belongs in Files: your own, one in a folder shared with you, or a file
 * shared with you on its own. What's only in an album shared with you stays out.
 */
export function inFiles(item: SharedItem, folders: readonly Folder[]): boolean {
  return !item.sharedAlbum || item.sharedFile === true || inSharedFolder(item, folders);
}

/**
 * Whether a file may be renamed, moved or deleted here: your own (not one in a library you
 * may only view), or one shared with you to edit, on its own or in a folder shared with you.
 */
export function editableFile(item: SharedItem, folders: readonly Folder[]): boolean {
  if (item.viewOnly) return false;
  if (!item.sharedAlbum) return true;
  return item.sharedFile === true || inSharedFolder(item, folders);
}

/** Whether a folder's menu offers changes: not one you may only view, nor a shared folder itself (that's its owner's). */
export function changeableHere(folder: Folder): boolean {
  return !folder.viewOnly && !(folder.sharedFolder && folder.parentId === undefined);
}
