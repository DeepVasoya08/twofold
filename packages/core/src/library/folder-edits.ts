/**
 * Changes people given a shared folder as "Add and edit" make inside it. They can't change
 * the owner's own records, so each change waits, sealed under the folder's key, until the
 * owner's device makes it. Until then everyone given the folder sees the changes still
 * waiting applied to what it lists; both sides check them here the same way, so a change
 * that reaches outside the folder (or no longer makes sense) is dropped everywhere.
 */
import type { FolderEdit } from '../records';

/** A shared folder as the changes see it. */
export interface SharedFolderState {
  /** The shared folder itself, which can't be renamed, moved or deleted this way. */
  root: string;
  /** The folders inside it at any depth, each with the folder it is in. */
  folders: Map<string, { name: string; parent: string }>;
  /** The files and photos filed anywhere inside it: which folder, and a file's name. */
  files: Map<string, { folder: string; name?: string }>;
}

/** Whether `id` is the shared folder or a folder inside it. */
export function inSharedFolder(state: SharedFolderState, id: string): boolean {
  return id === state.root || state.folders.has(id);
}

/** A folder and every folder inside it, at any depth. */
export function sharedSubtree(state: SharedFolderState, id: string): Set<string> {
  const tree = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [each, folder] of state.folders) {
      if (!tree.has(each) && tree.has(folder.parent)) {
        tree.add(each);
        grew = true;
      }
    }
  }
  return tree;
}

/**
 * Makes one change to `state`, if it makes sense there: what it names is inside the shared
 * folder, a new folder's id is new, a folder doesn't go inside itself, and only a file (not
 * a photo) is renamed. Returns whether it was made.
 */
export function applyFolderEdit(state: SharedFolderState, edit: FolderEdit): boolean {
  const { folders, files } = state;
  switch (edit.op) {
    case 'make-folder': {
      if (inSharedFolder(state, edit.id) || files.has(edit.id)) return false;
      if (!inSharedFolder(state, edit.parent)) return false;
      folders.set(edit.id, { name: edit.name, parent: edit.parent });
      return true;
    }
    case 'rename-folder': {
      const folder = folders.get(edit.id);
      if (!folder) return false;
      folders.set(edit.id, { ...folder, name: edit.name });
      return true;
    }
    case 'move-folder': {
      const folder = folders.get(edit.id);
      if (!folder || !inSharedFolder(state, edit.parent)) return false;
      if (sharedSubtree(state, edit.id).has(edit.parent)) return false;
      folders.set(edit.id, { ...folder, parent: edit.parent });
      return true;
    }
    case 'delete-folder': {
      if (!folders.has(edit.id)) return false;
      const tree = sharedSubtree(state, edit.id);
      for (const id of tree) folders.delete(id);
      for (const [id, file] of files) if (tree.has(file.folder)) files.delete(id);
      return true;
    }
    case 'rename-file': {
      const file = files.get(edit.file);
      if (file?.name === undefined) return false;
      files.set(edit.file, { ...file, name: edit.name });
      return true;
    }
    case 'move-file': {
      const file = files.get(edit.file);
      if (!file || !inSharedFolder(state, edit.folder)) return false;
      files.set(edit.file, { ...file, folder: edit.folder });
      return true;
    }
    case 'delete-file':
      return files.delete(edit.file);
  }
}

/** Whether a change is to folders only, which the owner's device makes before opening files. */
export function changesFolders(edit: FolderEdit): boolean {
  return edit.op === 'make-folder' || edit.op === 'rename-folder' || edit.op === 'move-folder';
}
