/**
 * Changes to folders that touch the store, shared by the web and phone apps: saving folders,
 * moving files between them, and deleting, restoring or deleting for good a folder with what
 * is inside it. Each reports what went through to `sink` as it goes, so the app shows it
 * even when a later step fails (and then throws).
 */
import { FormError } from '../errors';
import { settleEach } from '../settle-each';
import type { Settled } from '../settle-each';
import { folderName, folderRestore, folderTrash, folderTree, withFolder } from './folders';
import type { Folder, Photo } from './model';
import type { SpaceStore } from './space-store';
import { moveAll } from './trash';

/** What these changes need from a store. */
export type FolderStore = Pick<
  SpaceStore,
  'saveFolder' | 'update' | 'trash' | 'restore' | 'remove' | 'removeAlbum'
>;

/** Where each step's result goes, so the app can show it at once. */
export interface FolderSink {
  /** Folders saved as they are now. */
  saved: (folders: Folder[]) => void;
  /** Items moved into `folderId` (or to the top, for null). */
  moved?: (itemIds: string[], folderId: string | null) => void;
  /** Items moved to Recently deleted. */
  trashed?: (itemIds: string[], deletedAt: string) => void;
  /** Items back from Recently deleted. */
  restored?: (itemIds: string[]) => void;
  /** Items deleted for good. */
  removed?: (itemIds: string[]) => void;
  /** Folders deleted for good. */
  gone?: (folderIds: string[]) => void;
}

const FOLDER_GONE = 'That folder isn’t here anymore.';
const VIEW_ONLY_FOLDER = 'This folder was shared with you to view. You can’t change it.';

/** How many records are saved at once. */
const AT_ONCE = 4;

/** The first failure's error, as an Error to throw. */
function failure(settled: Settled<unknown>): Error {
  return settled.error instanceof Error ? settled.error : new FormError(FOLDER_GONE);
}

/** A folder that may be changed: here, and not in a library you can only view. */
export function changeableFolder(folders: readonly Folder[], folderId: string): Folder {
  const folder = folders.find((candidate) => candidate.id === folderId);
  if (!folder) throw new FormError(FOLDER_GONE);
  if (folder.viewOnly) throw new FormError(VIEW_ONLY_FOLDER);
  return folder;
}

/** Saves folders, a few at a time; those saved reach `sink` even if others fail. */
export async function saveFolders(
  store: FolderStore,
  changed: readonly Folder[],
  sink: FolderSink,
): Promise<void> {
  const result = await settleEach(changed, AT_ONCE, (folder) => store.saveFolder(folder));
  sink.saved(result.done);
  if (result.failed.length > 0) throw failure(result);
}

/** A folder renamed, its name checked. */
export async function renameFolder(
  store: FolderStore,
  folders: readonly Folder[],
  folderId: string,
  name: string,
  sink: FolderSink,
): Promise<void> {
  const folder = changeableFolder(folders, folderId);
  await saveFolders(store, [{ ...folder, name: folderName(name) }], sink);
}

/**
 * Moves items into `folderId` (or to the top of Files, for null), saving only those that
 * change. Each goes through or fails on its own; `check` refuses those that can't move.
 */
export async function moveToFolder(
  store: FolderStore,
  folders: readonly Folder[],
  items: readonly Photo[],
  itemIds: readonly string[],
  folderId: string | null,
  sink: FolderSink,
  check: (item: Photo) => void = () => undefined,
): Promise<Settled<string>> {
  const target = folderId === null ? undefined : changeableFolder(folders, folderId);
  const byId = new Map(items.map((item) => [item.id, item]));
  const result = await settleEach(itemIds, AT_ONCE, async (itemId) => {
    const item = byId.get(itemId);
    if (!item) throw new FormError('That file isn’t here anymore.');
    check(item);
    if (target && item.library !== target.library) {
      throw new FormError('Files can only go in folders of their own library.');
    }
    const moved = withFolder(item, folderId, folders);
    if (moved !== item) await store.update(moved);
  });
  sink.moved?.(result.done, folderId);
  return result;
}

/** Moves a folder, with what is inside it, to Recently deleted. Files go first. */
export async function deleteFolder(
  store: FolderStore,
  folders: readonly Folder[],
  items: readonly Pick<Photo, 'id' | 'albumIds'>[],
  folderId: string,
  sink: FolderSink,
  deletedAt = new Date().toISOString(),
): Promise<void> {
  changeableFolder(folders, folderId);
  const { folderIds, itemIds } = folderTrash(folders, items, folderId);
  // If the files can't all go, the folder stays and still holds what's left.
  if (itemIds.length > 0) {
    const moved = await moveAll(itemIds, (ids) => store.trash(ids, deletedAt));
    sink.trashed?.(moved.done, deletedAt);
    if (moved.failed.length > 0) throw failure(moved);
  }
  await saveFolders(
    store,
    folders
      .filter((folder) => folderIds.includes(folder.id))
      .map((folder) => ({ ...folder, deletedAt })),
    sink,
  );
}

/** Brings a folder back from Recently deleted, with what was deleted along with it. */
export async function restoreFolder(
  store: FolderStore,
  folders: readonly Folder[],
  trash: readonly Pick<Photo, 'id' | 'albumIds' | 'deletedAt'>[],
  folderId: string,
  sink: FolderSink,
): Promise<void> {
  changeableFolder(folders, folderId);
  const plan = folderRestore(folders, trash, folderId);
  await saveFolders(
    store,
    folders
      .filter((folder) => plan.folderIds.includes(folder.id))
      .map((folder) => {
        const back = { ...folder };
        delete back.deletedAt;
        if (folder.id === folderId && plan.moveToTop) delete back.parentId;
        return back;
      }),
    sink,
  );
  if (plan.itemIds.length === 0) return;
  const result = await moveAll(plan.itemIds, (ids) => store.restore(ids));
  sink.restored?.(result.done);
  if (result.failed.length > 0) throw failure(result);
}

/** Deletes a folder in Recently deleted for good, with what was deleted along with it. */
export async function deleteFolderForGood(
  store: FolderStore,
  folders: readonly Folder[],
  trash: readonly Pick<Photo, 'id' | 'albumIds' | 'deletedAt'>[],
  folderId: string,
  sink: FolderSink,
): Promise<void> {
  const folder = changeableFolder(folders, folderId);
  const together = folders.filter((each) => each.deletedAt === folder.deletedAt);
  const tree = folderTree(together, folderId);
  const itemIds = trash
    .filter(
      (item) => item.deletedAt === folder.deletedAt && item.albumIds.some((id) => tree.has(id)),
    )
    .map((item) => item.id);
  const removed = await settleEach(itemIds, AT_ONCE, (id) => store.remove(id));
  sink.removed?.(removed.done);
  if (removed.failed.length > 0) throw failure(removed);
  const gone = await settleEach([...tree], AT_ONCE, (id) => store.removeAlbum(id));
  sink.gone?.(gone.done);
  if (gone.failed.length > 0) throw failure(gone);
}

/** Deletes for good the deleted folders whose 30 days are up (best effort). */
export async function purgeFolders(
  store: FolderStore,
  expired: readonly Folder[],
  sink: FolderSink,
): Promise<void> {
  const result = await settleEach(
    expired.filter((folder) => folder.library === undefined),
    AT_ONCE,
    (folder) => store.removeAlbum(folder.id),
  );
  if (result.done.length > 0) sink.gone?.(result.done.map((folder) => folder.id));
}
