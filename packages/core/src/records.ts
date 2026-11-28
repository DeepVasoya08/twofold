/**
 * The sealed record formats every Arcafold app reads and writes: a photo's (or file's)
 * metadata and an album's. They are sealed with packages/crypto before they leave the
 * device; these functions only shape and check the plaintext, so phones and the web app
 * stay byte-compatible.
 */
import { isCategory } from './file-categories';
import type { Category } from './file-categories';
import { MAX_FILE_NAME, cleanFileName, cleanFileType } from './file-types';
import { parseKeywords } from './keywords';
import { isPhotoType } from './photo-types';

/** Who added a photo to someone else's library: their member id and name. */
export interface AddedBy {
  id: string;
  name: string;
}

export interface PhotoMeta {
  v: 1;
  /** The photo's own file key, base64url. */
  key: string;
  type: string;
  width: number;
  height: number;
  takenAt: string;
  favorite: boolean;
  albumIds: string[];
  /** Set when a member (not the library's owner) added it. */
  by?: AddedBy;
  /** Set while it is in Recently deleted: when it was deleted (ISO 8601). */
  deletedAt?: string;
  /**
   * The original's fingerprint in this space (see photoFingerprint), so an import can skip
   * photos already here. Photos stored before fingerprints existed have none.
   */
  fp?: string;
  /**
   * Set for a file that isn't a photo, with its name. Apps from before files existed refuse
   * these records (their type isn't a photo's), so they never show a file as a broken photo.
   */
  kind?: 'file';
  name?: string;
  /** A file's own size in bytes, before encryption (its stored size includes a preview). */
  bytes?: number;
  /** Set when a file's preview is a real JPEG (a PDF's first page), not a stand-in. */
  preview?: boolean;
  /** A file's category, worked out on the device that added it or chosen by you. */
  category?: Category;
  /** A few words saying what a file is about, kept to learn from how you sort. */
  words?: string[];
  /** Set when you chose the category yourself. */
  sorted?: 'you';
}

export interface AlbumMeta {
  v: 1;
  title: string;
  /** The album's own key, base64url, once it has been shared. */
  shareKey?: string;
}

/**
 * A folder in Files. It is stored as an album record (the server can't tell the two apart),
 * and a file is in it when its `albumIds` name it. Its name is `name`, not `title`, so apps
 * from before folders existed refuse the record instead of showing it as an album.
 */
export interface FolderMeta {
  v: 1;
  kind: 'folder';
  name: string;
  /** The folder it is in; left out at the top of Files. */
  parent?: string;
  /** Set while it is in Recently deleted: when it was deleted (ISO 8601). */
  deletedAt?: string;
  /** Its own key, base64url, once it has been shared. */
  shareKey?: string;
}

/** The longest a folder's name may be, in characters. */
export const MAX_FOLDER_NAME = 100;

/**
 * What the people a folder is shared with see of it, sealed under the folder's own key: its
 * name, and the folders inside it at any depth (each naming the one it is in, which is the
 * shared folder itself for those directly inside).
 */
export interface FolderShareMeta {
  v: 1;
  kind: 'folder';
  name: string;
  folders: { id: string; name: string; parent: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseAddedBy(value: unknown): AddedBy | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null;
  }
  return { id: value.id, name: value.name };
}

export function parsePhotoMeta(value: unknown): PhotoMeta | null {
  if (!isRecord(value)) return null;
  const { v, key, type, width, height, takenAt, favorite, albumIds } = value;
  const by = parseAddedBy(value.by);
  const ok =
    by !== null &&
    v === 1 &&
    typeof key === 'string' &&
    typeof type === 'string' &&
    typeKnown(value.kind, value.name, type) &&
    typeof width === 'number' &&
    typeof height === 'number' &&
    typeof takenAt === 'string' &&
    !Number.isNaN(Date.parse(takenAt)) &&
    typeof favorite === 'boolean' &&
    Array.isArray(albumIds) &&
    albumIds.every((id) => typeof id === 'string');
  const { deletedAt, fp } = value;
  const deletedOk =
    deletedAt === undefined ||
    (typeof deletedAt === 'string' && !Number.isNaN(Date.parse(deletedAt)));
  const fpOk = fp === undefined || typeof fp === 'string';
  if (!ok || !deletedOk || !fpOk) return null;
  const meta: PhotoMeta = { v, key, type, width, height, takenAt, favorite, albumIds };
  if (by) meta.by = by;
  if (deletedAt !== undefined) meta.deletedAt = deletedAt;
  if (fp !== undefined) meta.fp = fp;
  if (value.kind === 'file' && typeof value.name === 'string') {
    meta.kind = 'file';
    // Cleaned again here: a member's record can carry any name, folders and `..` included.
    meta.name = cleanFileName(value.name);
    if (typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes >= 0) {
      meta.bytes = value.bytes;
    }
    if (value.preview === true) meta.preview = true;
    if (isCategory(value.category)) meta.category = value.category;
    const words = parseKeywords(value.words);
    if (words) meta.words = words;
    if (value.sorted === 'you') meta.sorted = 'you';
  }
  return meta;
}

/** Whether a record's preview is an image: every photo's, and a file's own drawn one. */
export function hasPreview(meta: PhotoMeta): boolean {
  return meta.kind !== 'file' || meta.preview === true;
}

/** A photo's type must be a photo format; a file's may be any type, with a usable name. */
export function typeKnown(kind: unknown, name: unknown, type: string): boolean {
  if (kind === undefined) return isPhotoType(type);
  return (
    kind === 'file' &&
    typeof name === 'string' &&
    name.length > 0 &&
    Array.from(name).length <= MAX_FILE_NAME &&
    cleanFileType(type) === type
  );
}

export function parseAlbumMeta(value: unknown): AlbumMeta | null {
  if (!isRecord(value) || value.v !== 1 || typeof value.title !== 'string') return null;
  const meta: AlbumMeta = { v: 1, title: value.title };
  if (typeof value.shareKey === 'string') meta.shareKey = value.shareKey;
  else if (value.shareKey !== undefined) return null;
  return meta;
}

export function parseFolderMeta(value: unknown): FolderMeta | null {
  if (!isRecord(value) || value.v !== 1 || value.kind !== 'folder') return null;
  const { name, parent, deletedAt, shareKey } = value;
  if (typeof name !== 'string' || name.length === 0) return null;
  if (Array.from(name).length > MAX_FOLDER_NAME) return null;
  if (parent !== undefined && (typeof parent !== 'string' || parent.length === 0)) return null;
  if (
    deletedAt !== undefined &&
    (typeof deletedAt !== 'string' || Number.isNaN(Date.parse(deletedAt)))
  ) {
    return null;
  }
  if (shareKey !== undefined && typeof shareKey !== 'string') return null;
  const meta: FolderMeta = { v: 1, kind: 'folder', name };
  if (parent !== undefined) meta.parent = parent;
  if (deletedAt !== undefined) meta.deletedAt = deletedAt;
  if (shareKey !== undefined) meta.shareKey = shareKey;
  return meta;
}

/** A shared folder's record, or null when `value` isn't one. */
export function parseFolderShareMeta(value: unknown): FolderShareMeta | null {
  if (!isRecord(value) || value.v !== 1 || value.kind !== 'folder') return null;
  const { name, folders } = value;
  if (!validName(name) || !Array.isArray(folders)) return null;
  const inside: FolderShareMeta['folders'] = [];
  for (const each of folders as unknown[]) {
    if (!isRecord(each)) return null;
    const { id, name: folderName, parent } = each;
    if (typeof id !== 'string' || id.length === 0 || !validName(folderName)) return null;
    if (typeof parent !== 'string' || parent.length === 0) return null;
    inside.push({ id, name: folderName, parent });
  }
  return { v: 1, kind: 'folder', name, folders: inside };
}

/**
 * One file shared on its own. It is kept as an album row (so it can be shared like one), and
 * only its owner's apps read this record: which file it is, and its key once shared.
 */
export interface FileShareMeta {
  v: 1;
  kind: 'file-share';
  file: string;
  shareKey?: string;
}

/** What the people one file is shared with see of it, sealed under its share key. */
export interface SharedFileMeta {
  v: 1;
  kind: 'file';
  name: string;
}

export function parseFileShareMeta(value: unknown): FileShareMeta | null {
  if (!isRecord(value) || value.v !== 1 || value.kind !== 'file-share') return null;
  const { file, shareKey } = value;
  if (!isId(file)) return null;
  if (shareKey !== undefined && typeof shareKey !== 'string') return null;
  return { v: 1, kind: 'file-share', file, ...(shareKey !== undefined && { shareKey }) };
}

export function parseSharedFileMeta(value: unknown): SharedFileMeta | null {
  if (!isRecord(value) || value.v !== 1 || value.kind !== 'file') return null;
  return isFileName(value.name) ? { v: 1, kind: 'file', name: value.name } : null;
}

/**
 * A change someone given a shared folder as "Add and edit" made inside it, sealed under the
 * folder's key until the owner's device makes it in the space's own records. Folders and
 * files are named by id; `at` is when something was deleted (ISO 8601), so what went
 * together comes back together.
 */
export type FolderEdit =
  | { v: 1; op: 'make-folder'; id: string; name: string; parent: string }
  | { v: 1; op: 'rename-folder'; id: string; name: string }
  | { v: 1; op: 'move-folder'; id: string; parent: string }
  | { v: 1; op: 'delete-folder'; id: string; at: string }
  | { v: 1; op: 'rename-file'; file: string; name: string }
  | { v: 1; op: 'move-file'; file: string; folder: string }
  | { v: 1; op: 'delete-file'; file: string; at: string }
  | { v: 1; op: 'replace-file'; file: string; by: string };

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isTime = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));
const isFileName = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= MAX_FILE_NAME;

/** A shared folder's change, or null when `value` isn't one this app knows. */
export function parseFolderEdit(value: unknown): FolderEdit | null {
  if (!isRecord(value) || value.v !== 1) return null;
  const { op, id, name, parent, at, file, folder } = value;
  switch (op) {
    case 'make-folder':
      return isId(id) && validName(name) && isId(parent) ? { v: 1, op, id, name, parent } : null;
    case 'rename-folder':
      return isId(id) && validName(name) ? { v: 1, op, id, name } : null;
    case 'move-folder':
      return isId(id) && isId(parent) ? { v: 1, op, id, parent } : null;
    case 'delete-folder':
      return isId(id) && isTime(at) ? { v: 1, op, id, at } : null;
    case 'rename-file':
      return isId(file) && isFileName(name) ? { v: 1, op, file, name } : null;
    case 'move-file':
      return isId(file) && isId(folder) ? { v: 1, op, file, folder } : null;
    case 'delete-file':
      return isId(file) && isTime(at) ? { v: 1, op, file, at } : null;
    case 'replace-file':
      return isId(file) && isId(value.by) && file !== value.by
        ? { v: 1, op, file, by: value.by }
        : null;
    default:
      return null;
  }
}

function validName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && Array.from(name).length <= MAX_FOLDER_NAME;
}

/**
 * A shared folder's record as the bytes that get sealed, padded to a whole number of KiB so
 * its size says little about how many folders are inside.
 */
export function encodeFolderShareMeta(meta: FolderShareMeta): Uint8Array<ArrayBuffer> {
  const bytes = encodeJson({ ...meta, pad: '' });
  const missing = Math.ceil(bytes.length / 1024) * 1024 - bytes.length;
  return missing > 0 ? encodeJson({ ...meta, pad: ' '.repeat(missing) }) : bytes;
}

/** A record as the bytes that get sealed. */
export function encodeJson(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(value));
}

/**
 * Every photo record is at least this many bytes before sealing, so a file's (with its name,
 * category and words) is the same size as a photo's and the server can't pick files out.
 */
export const PHOTO_RECORD_MIN = 1000;

/**
 * A photo's metadata, encoded at PHOTO_RECORD_MIN bytes or more: spaces fill a `pad` field
 * that's ignored when read. A file's words are dropped, last first, rather than let its
 * record grow past that.
 */
export function encodePhotoMeta(meta: PhotoMeta): Uint8Array<ArrayBuffer> {
  let fitted = meta;
  while (fitted.words && fitted.words.length > 0 && encodeJson(fitted).length > PHOTO_RECORD_MIN) {
    fitted = { ...fitted, words: fitted.words.slice(0, -1) };
  }
  const bytes = encodeJson({ ...fitted, pad: '' });
  const missing = PHOTO_RECORD_MIN - bytes.length;
  return missing > 0 ? encodeJson({ ...fitted, pad: ' '.repeat(missing) }) : bytes;
}

/** An opened record's bytes as JSON, or null when they aren't JSON. */
export function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
