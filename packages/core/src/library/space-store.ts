import type { SpaceAccess, SpaceKeys, UploadKeyPair } from '@arcafold/crypto';
import { STORAGE_SIZES, THUMB_BATCH_MAX, TRASH_BATCH_MAX } from '@arcafold/types';
import type { PhotoPage, PhotoPart, StoredFolderEdit } from '@arcafold/types';

import { ApiError, spaceApi } from '../api';
import { loadCrypto } from '../crypto-loader';
import type { SpaceApi } from '../api';
import { FormError } from '../errors';
import type { Category } from '../file-categories';
import { cleanFileName, cleanFileType, isJpeg } from '../file-types';
import { isPhotoType } from '../photo-types';
import {
  decodeJson,
  encodeFolderShareMeta,
  encodeJson,
  encodePhotoMeta,
  hasPreview,
  parseAlbumMeta,
  parseFileShareMeta,
  parseFolderEdit,
  parseFolderMeta,
  parseFolderShareMeta,
  parsePhotoMeta,
  parseSharedFileMeta,
} from '../records';
import type {
  AlbumMeta,
  FileShareMeta,
  FolderEdit,
  FolderMeta,
  FolderShareMeta,
  PhotoMeta,
} from '../records';
import { uploadKeyPair } from '../upload/upload-only';
import {
  applyFolderEdit,
  changesFolders,
  changesOneFile,
  inSharedFolder,
  sharedSubtree,
} from './folder-edits';
import type { SharedFolderState } from './folder-edits';
import { folderName } from './folders';
import type { Album, FileDetails, Folder, Photo } from './model';

/**
 * One space's photos and albums, stored encrypted on the server. Every photo has its own
 * key, kept inside the photo's sealed metadata; the metadata and albums are sealed under the
 * space key. Decrypted images only ever exist in memory (object URLs on web), freed on dispose.
 */

/** What a store needs from the platform it runs on. */
export interface LibraryPlatform {
  /** Makes decrypted image bytes showable, kept in memory only: an object URL on web. */
  showImage: (bytes: Uint8Array<ArrayBuffer>, type: string) => string;
  /** Frees what showImage made. */
  releaseImage: (src: string) => void;
  /**
   * A JPEG copy to show in place of an original this platform can't show (HEIC in most
   * browsers), made in memory. Null when the original shows as it is.
   */
  viewableCopy: (
    original: Uint8Array<ArrayBuffer>,
    type: string,
  ) => Promise<Uint8Array<ArrayBuffer> | null>;
}

const browserPlatform: LibraryPlatform = {
  showImage: (bytes, type) => URL.createObjectURL(new Blob([bytes], { type })),
  releaseImage: (src) => {
    URL.revokeObjectURL(src);
  },
  viewableCopy: () => Promise.resolve(null),
};

let platform: LibraryPlatform = browserPlatform;

/** Sets how stores load crypto and show images. Defaults suit a browser. */
export function configureLibrary(next: Partial<LibraryPlatform>): void {
  platform = { ...platform, ...next };
}

/**
 * Thrown by `thumbs` when some previews arrived and others failed (the batch was cut off or
 * couldn't be reached). The ones it got are shown; only the failed ones are tried again.
 */
export class PartialThumbs extends Error {
  constructor(
    readonly found: ReadonlyMap<string, string>,
    readonly failed: readonly string[],
  ) {
    super('Some previews could not be downloaded.');
  }
}

/** A photo's decrypted original and what's needed to save a copy of it. */
export interface Original {
  /** The original file, byte for byte. */
  full: Uint8Array<ArrayBuffer>;
  /** The original's media type. */
  type: string;
  takenAt: string;
  /** For a file (not a photo): its own name, to save it under. */
  name?: string;
}

/** The decrypted files and details of a photo, for adding it to a space. */
export interface NewPhoto {
  /** A JPEG preview. */
  thumb: Uint8Array<ArrayBuffer>;
  /** The original file, byte for byte. */
  full: Uint8Array<ArrayBuffer>;
  /** The original's media type. */
  type: string;
  width: number;
  height: number;
  takenAt: string;
  /** Whether it starts as a favorite, as when an import brings one over. */
  favorite?: boolean;
  /**
   * Set for a file that isn't a photo: its name. `type` is then any media type but video,
   * `thumb` a stand-in preview the app never shows, and width and height are 0.
   */
  file?: {
    name: string;
    /** Whether `thumb` is a real preview (a PDF's first page) rather than a stand-in. */
    preview?: boolean;
    /** The category it was sorted into, if it was (lib/file-sort). */
    category?: Category;
    /** The words kept to learn from, when it was sorted. */
    words?: string[];
    /** Whether you chose the category yourself, so it teaches the sorting. */
    sortedByYou?: boolean;
  };
}

/** Where an upload is: encrypting on this device, then sending ciphertext. */
export type UploadStage = 'encrypting' | 'uploading';

/** What a space holds, as `SpaceStore.list` hands it back. */
export interface SpaceContents {
  photos: Photo[];
  albums: Album[];
  /** Folders in Files, including those in Recently deleted (with `deletedAt`). */
  folders: Folder[];
}

export interface SpaceStore {
  /**
   * Every photo, album and folder. Photos come without images (`src` is empty) until
   * `image`.
   */
  list: () => Promise<SpaceContents>;
  /**
   * Downloads and decrypts a photo's preview or original into an object URL. Only the
   * latest original is kept: asking for another revokes the previous one.
   */
  image: (photoId: string, part: PhotoPart) => Promise<string>;
  /**
   * After `image(photoId, 'full')`: an object URL of a JPEG copy to show instead of the
   * original, when this browser can't show the original (HEIC outside Safari). Undefined
   * when the original shows as it is. Downloads still use the original.
   */
  viewImage: (photoId: string) => string | undefined;
  /**
   * Downloads and decrypts many previews, in as few requests as it can. Returns an object
   * URL for each one it got; photos it doesn't know, or whose preview didn't decrypt, are
   * left out. Each preview also reaches `onThumb` as soon as it is decrypted, before the
   * rest have arrived. If a download fails part way, it throws PartialThumbs with the ones
   * it got.
   */
  thumbs: (
    photoIds: readonly string[],
    onThumb?: (photoId: string, url: string) => void,
  ) => Promise<Map<string, string>>;
  /**
   * Downloads and decrypts previews to look at on this device (for finding faces), without
   * keeping them: each reaches `onPreview` as bytes, in memory only, and no object URL is
   * made. Photos it doesn't know, or whose preview is missing or didn't decrypt, reach it as
   * null. Throws if a download fails.
   */
  previews: (
    photoIds: readonly string[],
    onPreview: (photoId: string, bytes: Uint8Array<ArrayBuffer> | null) => void,
  ) => Promise<void>;
  add: (
    photo: NewPhoto,
    albumIds: string[],
    onStage?: (stage: UploadStage) => void,
  ) => Promise<Photo>;
  /** Saves a photo's favorite and albums. */
  update: (photo: Photo) => Promise<void>;
  /** Deletes a photo and its files for good. */
  remove: (photoId: string) => Promise<void>;
  /**
   * Photos in Recently deleted, each with `deletedAt`. Empty where you can only view (the
   * server doesn't show it there).
   */
  listTrash: () => Promise<Photo[]>;
  /**
   * Moves photos into Recently deleted, recording when in their sealed metadata (the server
   * never learns it). Returns the ids it moved; ones it doesn't know or that were already
   * moved are left out.
   */
  trash: (photoIds: readonly string[], deletedAt: string) => Promise<string[]>;
  /** Brings photos back from Recently deleted. Returns the ids it moved. */
  restore: (photoIds: readonly string[]) => Promise<string[]>;
  createAlbum: (title: string) => Promise<Album>;
  renameAlbum: (albumId: string, title: string) => Promise<void>;
  /**
   * Deletes an album, or a folder, for good. Its photos stay; take it out of them with
   * `update`.
   */
  removeAlbum: (albumId: string) => Promise<void>;
  /** Makes a folder in Files, inside `parentId` or at the top. */
  createFolder: (name: string, parentId?: string) => Promise<Folder>;
  /**
   * Saves a folder's name, where it is, and whether it is in Recently deleted. Files go in
   * and out of folders with `update`, like albums.
   */
  saveFolder: (folder: Folder) => Promise<void>;
  /**
   * Gets an album of your own ready to share with people: gives it a key of its own if it
   * has none, and lists its photos (sealed under that key) for them. Returns the album key,
   * which is what the people it's shared with get, never the space's records key. Photos put
   * in or taken out of a shared album later are listed or unlisted as they change.
   */
  shareAlbum: (albumId: string) => Promise<Uint8Array>;
  /** Stops sharing an album with everyone, and lets its key go. */
  stopSharingAlbum: (albumId: string) => Promise<void>;
  /**
   * Gets one of your files ready to share on its own: the id of the album row it is shared
   * through (made the first time), which `shareAlbum` and the rest then take like an album's.
   */
  shareFile: (photoId: string) => Promise<string>;
  /**
   * For a file shared with you to edit: uploads a new version of it, which takes its place
   * (the old one goes to its owner's Recently deleted). Returns the new version.
   */
  replaceFile: (photoId: string, photo: NewPhoto) => Promise<Photo>;
  /** Downloads and decrypts a photo's files, to add them to another space. */
  read: (photoId: string) => Promise<NewPhoto>;
  /**
   * Downloads and decrypts only a photo's original, to save a copy of it. Nothing is kept:
   * the bytes are the caller's, in memory only.
   */
  original: (photoId: string) => Promise<Original>;
  /**
   * The fingerprint a photo's original has in this space: the same bytes always give the
   * same fingerprint here, and nothing the server could match elsewhere.
   */
  fingerprint: (original: Uint8Array) => Promise<string>;
  /**
   * Fingerprints of the photos listed so far (including Recently deleted once it has been
   * listed), each with its photo's id, for skipping photos already here.
   */
  fingerprints: () => ReadonlyMap<string, string>;
  /**
   * A value that changes whenever anything this store lists may have changed, on this device
   * or any other. Only compared with an earlier one: when it differs, list again.
   */
  stamp: () => Promise<string>;
  /** Revokes every object URL this store made. */
  dispose: () => void;
}

const THUMB_TYPE = 'image/jpeg';
const LARGEST_MB = String(Math.floor(STORAGE_SIZES.maxFull / (1024 * 1024)) - 1);
const TOO_LARGE = `That photo is too large. Arcafold takes photos up to ${LARGEST_MB} MB.`;
const FILE_TOO_LARGE = `That file is too large. Arcafold takes files up to ${LARGEST_MB} MB.`;

/** How this device reaches a library someone shared with it. */
export interface Membership {
  /** This account's member id in that library. */
  memberId: string;
  /** This account's name, recorded on photos it adds there. */
  myName: string;
  /** The name of whoever shared the library. */
  ownerName: string;
  /**
   * Set when only this album (or folder) was shared. New photos go into it (and only it, or
   * a folder inside it), and taking a photo out of it only unlists it there.
   */
  album?: string;
}

/** A file's name and type, if the record is a file's. */
function fileOf(meta: PhotoMeta): FileDetails | undefined {
  return meta.kind === 'file' && meta.name !== undefined
    ? {
        name: meta.name,
        type: meta.type,
        ...(meta.bytes !== undefined && { bytes: meta.bytes }),
        ...(meta.preview && { preview: true }),
        ...(meta.category && { category: meta.category }),
        ...(meta.words && { words: meta.words }),
        ...(meta.sorted && { sortedByYou: true }),
      }
    : undefined;
}

const NOT_A_PHOTO = 'That’s a file, not a photo. Download it to open it.';

const ALBUM_GONE = 'That album isn’t here anymore.';
const FOLDER_GONE = 'That folder isn’t here anymore.';

/** A folder as the apps show it. */
function toFolder(id: string, meta: FolderMeta): Folder {
  return {
    id,
    name: meta.name,
    ...(meta.parent !== undefined && { parentId: meta.parent }),
    ...(meta.deletedAt !== undefined && { deletedAt: meta.deletedAt }),
  };
}
const ALBUM_ONLY = 'In an album shared with you, you can add photos or take them out.';
const TOO_MANY_FOLDERS = 'This folder has too many folders inside it to share.';
const OWNER_ONLY_FOLDER = 'Only the person who shared this folder can rename, move or delete it.';
const STAYS_SHARED = 'Files in a folder shared with you stay in it.';
const NOT_YOURS_FILE = 'Only your own files can be shared.';
const FILE_GONE = 'That file isn’t here anymore.';
const FILE_ONLY = 'In a file shared with you, you can rename it or upload a new version.';
const NOT_HERE = 'That can’t be done in this shared folder anymore. Reload to see it as it is now.';

/** Whether trying again can't help: the server (or this device) said no for good. */
function refused(error: unknown): boolean {
  if (error instanceof FormError) return true;
  return error instanceof ApiError && [400, 404, 409].includes(error.status);
}

/** Who added a photo, as this device sees it. The owner's photos carry no `by`. */
function addedBy(
  meta: PhotoMeta,
  membership: Membership | null,
): Pick<Photo, 'addedBy' | 'addedByName'> {
  const mine = meta.by ? meta.by.id === membership?.memberId : membership === null;
  if (mine) return { addedBy: 'me' };
  return { addedBy: 'contact', addedByName: meta.by?.name ?? membership?.ownerName ?? '' };
}

function toPhoto(
  id: string,
  meta: PhotoMeta,
  membership: Membership | null,
  size: number,
  src = '',
): Photo {
  const photo: Photo = {
    id,
    src,
    size,
    width: meta.width,
    height: meta.height,
    takenAt: meta.takenAt,
    ...addedBy(meta, membership),
    favorite: meta.favorite,
    albumIds: meta.albumIds,
    ...(meta.deletedAt !== undefined && { deletedAt: meta.deletedAt }),
  };
  const file = fileOf(meta);
  return file ? { ...photo, file } : photo;
}

/** What the store keeps per photo: its file key and type, which the UI never needs. */
interface Known {
  key: Uint8Array;
  meta: PhotoMeta;
}

/**
 * A store for one space: your own (from its keys) or one shared with you (from the access
 * your invite delivered, with `membership` saying who you are there).
 */
export function remoteStore(
  space: SpaceKeys | SpaceAccess,
  makeApi: (token: string) => SpaceApi = spaceApi,
  membership: Membership | null = null,
): SpaceStore {
  let accessPromise: Promise<SpaceAccess> | null = null;
  const access = () =>
    (accessPromise ??=
      'spaceKey' in space
        ? loadCrypto().then((crypto) => crypto.ownerAccess(space))
        : Promise.resolve(space));
  let apiPromise: Promise<SpaceApi> | null = null;
  const remote = () => (apiPromise ??= access().then((opened) => makeApi(opened.token)));
  const known = new Map<string, Known>();
  const albumMetas = new Map<string, AlbumMeta>();
  const folderMetas = new Map<string, FolderMeta>();
  /** Files of yours shared on their own: each one's album row, with which file it is. */
  const fileShares = new Map<string, FileShareMeta>();
  /** The album row a file of yours is shared through, if it is. */
  const fileShareOf = (photoId: string) => {
    for (const [id, meta] of fileShares) if (meta.file === photoId) return id;
    return undefined;
  };
  const urls = new Map<string, string>();

  const track = (
    photoId: string,
    part: PhotoPart | 'view',
    bytes: Uint8Array<ArrayBuffer>,
    type: string,
  ) => {
    const name = `${photoId}/${part}`;
    const previous = urls.get(name);
    if (previous) return previous;
    const url = platform.showImage(bytes, type);
    urls.set(name, url);
    return url;
  };

  const forget = (photoId: string) => {
    known.delete(photoId);
    for (const part of ['thumb', 'full', 'view'] as const) {
      const url = urls.get(`${photoId}/${part}`);
      if (url) platform.releaseImage(url);
      urls.delete(`${photoId}/${part}`);
    }
  };

  const lookup = (photoId: string): Known => {
    const entry = known.get(photoId);
    if (!entry) throw new FormError('That photo isn’t in your vault anymore.');
    return entry;
  };

  const sealPhoto = async (id: string, meta: PhotoMeta) => {
    const crypto = await loadCrypto();
    return crypto.sealRecord(await access(), 'photo', id, encodePhotoMeta(meta));
  };

  const sealAlbum = async (id: string, meta: AlbumMeta | FolderMeta | FileShareMeta) => {
    const crypto = await loadCrypto();
    return crypto.sealRecord(await access(), 'album', id, encodeJson(meta));
  };

  /**
   * The folders inside a folder at any depth that aren't in Recently deleted, each with the
   * folder it is in.
   */
  const foldersInside = (rootId: string) => {
    const inside: FolderShareMeta['folders'] = [];
    const seen = new Set([rootId]);
    let level = [rootId];
    while (level.length > 0) {
      const next: string[] = [];
      for (const [id, meta] of folderMetas) {
        if (meta.parent === undefined || !level.includes(meta.parent) || seen.has(id)) continue;
        if (meta.deletedAt !== undefined) continue;
        seen.add(id);
        inside.push({ id, name: meta.name, parent: meta.parent });
        next.push(id);
      }
      level = next;
    }
    return inside;
  };

  /**
   * The shares a photo filed in these albums and folders is listed in, each with what it is
   * filed under there: an album or folder that is shared itself, and every shared folder a
   * folder is inside.
   */
  const sharesOf = (albumIds: readonly string[]) => {
    const found = new Map<string, string>();
    for (const id of albumIds) {
      if (albumMetas.get(id)?.shareKey) found.set(id, id);
      const seen = new Set<string>();
      let at: string | undefined = id;
      while (at !== undefined && !seen.has(at)) {
        seen.add(at);
        const meta = folderMetas.get(at);
        if (!meta || meta.deletedAt !== undefined) break;
        if (meta.shareKey) found.set(at, id);
        at = meta.parent;
      }
    }
    return found;
  };

  /** What a shared album's or folder's records are sealed under, or null if it isn't shared. */
  const sharedAccess = async (albumId: string): Promise<SpaceAccess | null> => {
    const key =
      albumMetas.get(albumId)?.shareKey ??
      folderMetas.get(albumId)?.shareKey ??
      fileShares.get(albumId)?.shareKey;
    if (!key) return null;
    const crypto = await loadCrypto();
    return crypto.albumAccess(
      (await access()).token,
      crypto.fromBase64Url(key) ?? new Uint8Array(),
    );
  };

  /**
   * Lists a photo in a shared album or folder: its details sealed under that key, without its
   * favorite or the rest of its albums, which stay yours. In a shared folder it's filed under
   * `filedIn`, the folder inside it that holds the photo.
   */
  const listInAlbum = async (
    shared: SpaceAccess,
    albumId: string,
    photoId: string,
    filedIn = albumId,
  ) => {
    const entry = lookup(photoId);
    const crypto = await loadCrypto();
    // What you've taught the sorting stays yours: shared copies carry no words.
    const meta: PhotoMeta = { ...entry.meta, favorite: false, albumIds: [filedIn] };
    delete meta.words;
    delete meta.sorted;
    const api = await remote();
    await api.putAlbumItem(
      albumId,
      photoId,
      await crypto.sealRecord(shared, 'photo', photoId, encodePhotoMeta(meta)),
    );
  };

  /**
   * Brings the shared albums a photo went into or left up to date. Best effort: the photo's
   * own change is already saved, and sharing an album again lists anything missed.
   */
  const syncShared = async (photoId: string, before: readonly string[], after: string[]) => {
    const api = await remote();
    const was = sharesOf(before);
    const now = sharesOf(after);
    const changes = [
      ...[...now]
        .filter(([id, filedIn]) => was.get(id) !== filedIn)
        .map(([id, filedIn]) => ({ id, filedIn })),
      ...[...was.keys()].filter((id) => !now.has(id)).map((id) => ({ id, filedIn: null })),
    ];
    await Promise.all(
      changes.map(async ({ id, filedIn }) => {
        const shared = await sharedAccess(id);
        if (!shared) return;
        if (filedIn !== null) await listInAlbum(shared, id, photoId, filedIn);
        else await api.deleteAlbumItem(id, photoId);
      }),
    ).catch(() => undefined);
  };

  /**
   * Brings a shared folder up to date for the people it's shared with: its name and the
   * folders inside it, sealed under its key, and every photo filed anywhere inside it listed
   * (and nothing else).
   */
  const syncFolderShare = async (rootId: string) => {
    const meta = folderMetas.get(rootId);
    const shared = await sharedAccess(rootId);
    if (!meta || !shared) return;
    const crypto = await loadCrypto();
    const api = await remote();
    const inside = foldersInside(rootId);
    const record = encodeFolderShareMeta({
      v: 1,
      kind: 'folder',
      name: meta.name,
      folders: inside,
    });
    const sealed = await crypto.sealSharedFolder(shared, rootId, record).catch(() => {
      throw new FormError(TOO_MANY_FOLDERS);
    });
    await api.shareAlbum(rootId, sealed);
    const tree = new Set([rootId, ...inside.map((folder) => folder.id)]);
    const listed = new Set((await api.listAlbumItems(rootId)).photoIds);
    for (const [photoId, entry] of known) {
      const filedIn = entry.meta.albumIds.find((id) => tree.has(id));
      if (filedIn === undefined || entry.meta.deletedAt !== undefined) continue;
      if (!listed.has(photoId)) await listInAlbum(shared, rootId, photoId, filedIn);
      listed.delete(photoId);
    }
    // What's in Recently deleted stays listed: the server hides it until it's restored.
    for (const photoId of listed) {
      if (known.get(photoId)?.meta.deletedAt === undefined) {
        await api.deleteAlbumItem(rootId, photoId);
      }
    }
  };

  /**
   * Brings a file shared on its own up to date for the people it's shared with: its name,
   * and it listed (with new versions they uploaded that haven't replaced it yet).
   */
  const syncFileShare = async (rowId: string) => {
    const share = fileShares.get(rowId);
    const shared = await sharedAccess(rowId);
    const entry = share && known.get(share.file);
    if (!share || !shared || !entry) return;
    const crypto = await loadCrypto();
    const api = await remote();
    const name = entry.meta.name ?? 'File';
    await api.shareAlbum(
      rowId,
      await crypto.sealRecord(shared, 'album', rowId, encodeJson({ v: 1, kind: 'file', name })),
    );
    const listed = new Set((await api.listAlbumItems(rowId)).photoIds);
    // Listed again each time, so its people see its name as it is now.
    if (entry.meta.deletedAt === undefined) await listInAlbum(shared, rowId, share.file, rowId);
    listed.delete(share.file);
    for (const photoId of listed) {
      const other = known.get(photoId);
      if (other && (other.meta.deletedAt !== undefined || other.meta.albumIds.includes(rowId))) {
        continue;
      }
      await api.deleteAlbumItem(rowId, photoId);
    }
  };

  /** Brings a shared folder, or a file shared on its own, up to date. */
  const syncShare = (rootId: string) =>
    fileShares.has(rootId) ? syncFileShare(rootId) : syncFolderShare(rootId);

  /** Brings every shared folder these folders are in up to date. Best effort. */
  const refreshShares = async (folderIds: readonly string[]) => {
    for (const rootId of sharesOf(folderIds).keys()) {
      if (folderMetas.has(rootId)) await syncFolderShare(rootId).catch(() => undefined);
    }
  };

  /** For someone given one folder: that folder and the folders inside it, by id. */
  let memberTree = new Set<string>();
  /**
   * For someone given one folder: it, as they see it now, with the changes still waiting
   * for its owner applied. Changes they make are checked against it first.
   */
  let memberShare: SharedFolderState | null = null;
  /** Whether what's shared with you is one file, not a folder. */
  let memberFile = false;

  /** A shared folder of your own as its changes see it, from your own records. */
  const ownerShareState = (rootId: string): SharedFolderState => {
    const single = fileShares.get(rootId);
    if (single) {
      // One file: it, and new versions people given it uploaded that haven't replaced it yet.
      const files = new Map<string, { folder: string; name?: string }>();
      for (const [photoId, entry] of known) {
        if (entry.meta.deletedAt !== undefined || entry.meta.kind !== 'file') continue;
        if (photoId !== single.file && !entry.meta.albumIds.includes(rootId)) continue;
        files.set(photoId, { folder: rootId, ...(entry.meta.name && { name: entry.meta.name }) });
      }
      return { root: rootId, folders: new Map(), files };
    }
    const folders = new Map(
      foldersInside(rootId).map((folder) => [
        folder.id,
        { name: folder.name, parent: folder.parent },
      ]),
    );
    const state: SharedFolderState = { root: rootId, folders, files: new Map() };
    for (const [photoId, entry] of known) {
      if (entry.meta.deletedAt !== undefined) continue;
      const folder = entry.meta.albumIds.find((id) => inSharedFolder(state, id));
      if (folder === undefined) continue;
      const name = entry.meta.kind === 'file' ? entry.meta.name : undefined;
      state.files.set(photoId, { folder, ...(name !== undefined && { name }) });
    }
    return state;
  };

  /** Saves a folder's record. One going to Recently deleted stops being shared, there and then. */
  const writeFolder = async (id: string, next: FolderMeta) => {
    const api = await remote();
    const meta = { ...next };
    if (meta.deletedAt !== undefined && meta.shareKey !== undefined) {
      await api.unshareAlbum(id);
      delete meta.shareKey;
    }
    await api.updateAlbum(id, await sealAlbum(id, meta));
    folderMetas.set(id, meta);
  };

  /**
   * Makes, in your own records, a change someone given a shared folder made inside it. It
   * has been checked against `state` as it was just before (`inside`: the shared folder's
   * folders then; `tree`: a deleted folder's folders).
   */
  const makeEdit = async (
    edit: FolderEdit,
    inside: (id: string) => boolean,
    tree: ReadonlySet<string>,
  ) => {
    const api = await remote();
    switch (edit.op) {
      case 'make-folder': {
        const meta: FolderMeta = { v: 1, kind: 'folder', name: edit.name, parent: edit.parent };
        await api.createAlbum({ id: edit.id, meta: await sealAlbum(edit.id, meta) });
        folderMetas.set(edit.id, meta);
        return;
      }
      case 'rename-folder':
      case 'move-folder': {
        const current = folderMetas.get(edit.id);
        if (!current) return;
        await writeFolder(
          edit.id,
          edit.op === 'rename-folder'
            ? { ...current, name: edit.name }
            : { ...current, parent: edit.parent },
        );
        return;
      }
      case 'delete-folder': {
        // Files first, as when you delete a folder: if they can't go, the folder stays.
        const files = [...known]
          .filter(([, entry]) => entry.meta.deletedAt === undefined)
          .filter(([, entry]) => entry.meta.albumIds.some((id) => tree.has(id)))
          .map(([id]) => id);
        const trashed = await moveTrash(
          files,
          (meta) => ({ ...meta, deletedAt: edit.at }),
          api.trashPhotos,
        );
        if (trashed.length < files.length) throw new FormError(NOT_HERE);
        for (const id of tree) {
          const current = folderMetas.get(id);
          if (current) await writeFolder(id, { ...current, deletedAt: edit.at });
        }
        return;
      }
      case 'rename-file':
      case 'move-file': {
        const entry = lookup(edit.file);
        const meta: PhotoMeta =
          edit.op === 'rename-file'
            ? { ...entry.meta, name: cleanFileName(edit.name) }
            : {
                ...entry.meta,
                albumIds: [...entry.meta.albumIds.filter((id) => !inside(id)), edit.folder],
              };
        await api.updatePhoto(edit.file, await sealPhoto(edit.file, meta));
        known.set(edit.file, { ...entry, meta });
        await syncShared(edit.file, entry.meta.albumIds, meta.albumIds);
        return;
      }
      case 'replace-file': {
        // The new version goes where the old one was (its folder and albums), and the old
        // one to Recently deleted.
        const old = lookup(edit.file);
        const next = lookup(edit.by);
        const albumIds = old.meta.albumIds;
        const meta: PhotoMeta = { ...next.meta, albumIds, favorite: old.meta.favorite };
        await api.updatePhoto(edit.by, await sealPhoto(edit.by, meta));
        known.set(edit.by, { ...next, meta });
        await syncShared(edit.by, next.meta.albumIds, albumIds);
        for (const [row, share] of fileShares) {
          if (share.file !== edit.file) continue;
          const moved: FileShareMeta = { ...share, file: edit.by };
          await api.updateAlbum(row, await sealAlbum(row, moved));
          fileShares.set(row, moved);
        }
        await moveTrash(
          [edit.file],
          (trashed) => ({ ...trashed, deletedAt: new Date().toISOString() }),
          api.trashPhotos,
        );
        return;
      }
      case 'delete-file': {
        const trashed = await moveTrash(
          [edit.file],
          (meta) => ({ ...meta, deletedAt: edit.at }),
          api.trashPhotos,
        );
        if (trashed.length === 0) throw new FormError(NOT_HERE);
        return;
      }
    }
  };

  /** Changes people given your shared folders made inside them, waiting to be made here. */
  let waitingEdits: { root: string; edits: StoredFolderEdit[] }[] = [];
  /** Shared folders changes were made in, to bring up to date for their people. */
  const editedShares = new Set<string>();

  /**
   * Makes the changes waiting in your shared folders, in the order they were made, and lets
   * the server forget each one made (or that no longer makes sense). Changes to folders
   * alone are made first, before files are opened, so a file put in a new folder finds it;
   * the rest once files are open. A change that fails stays, with those after it, for next
   * time. Returns whether anything changed.
   */
  const makeEdits = async (phase: 'folders' | 'files') => {
    if (membership?.album !== undefined || waitingEdits.length === 0) return false;
    const crypto = await loadCrypto();
    const api = await remote();
    let changed = false;
    for (const waiting of waitingEdits) {
      const shared = await sharedAccess(waiting.root);
      if (!shared || folderMetas.get(waiting.root)?.deletedAt !== undefined) continue;
      // A shared file's changes wait for files to open.
      if (phase === 'folders' && fileShares.has(waiting.root)) continue;
      const state = ownerShareState(waiting.root);
      const left: StoredFolderEdit[] = [];
      let stuck = false;
      for (const stored of waiting.edits) {
        if (stuck) {
          left.push(stored);
          continue;
        }
        const edit = await crypto
          .openRecord(shared, 'folder-edit', stored.id, stored.meta)
          .then((opened) => parseFolderEdit(decodeJson(opened)))
          .catch(() => null);
        // Changes to files wait for the files to be open.
        if (edit && phase === 'folders' && !changesFolders(edit)) {
          left.push(stored);
          continue;
        }
        // Someone given one file can rename it or upload a new version, nothing else.
        if (edit && (!fileShares.has(waiting.root) || changesOneFile(edit))) {
          const before = new Set([waiting.root, ...state.folders.keys()]);
          const tree =
            edit.op === 'delete-folder' && state.folders.has(edit.id)
              ? sharedSubtree(state, edit.id)
              : new Set<string>();
          if (applyFolderEdit(state, edit)) {
            const made = await makeEdit(edit, (id) => before.has(id), tree).then(
              () => 'made' as const,
              (error: unknown) => (refused(error) ? ('refused' as const) : ('failed' as const)),
            );
            if (made === 'failed') {
              stuck = true;
              left.push(stored);
              continue;
            }
            changed = true;
            editedShares.add(waiting.root);
          }
        }
        // Made, or one that doesn't open or no longer makes sense: either way it's done.
        await api.forgetFolderEdit(waiting.root, stored.id).catch(() => undefined);
      }
      waiting.edits = left;
    }
    return changed;
  };

  const decrypt = async (photoId: string, part: PhotoPart) => {
    const entry = lookup(photoId);
    const api = await remote();
    const crypto = await loadCrypto();
    const sealed = await api.getFile(photoId, part);
    const plain =
      part === 'full'
        ? await crypto.decryptLargeFile(entry.key, sealed)
        : await crypto.decryptFile(entry.key, sealed);
    return { plain: new Uint8Array(plain), entry };
  };

  /**
   * Downloads and decrypts previews in batches, handing each to `deliver` as soon as it's
   * decrypted (null if the server had none or it didn't decrypt). Throws if a download fails.
   */
  const downloadThumbs = async (
    photoIds: readonly string[],
    deliver: (photoId: string, plain: Uint8Array<ArrayBuffer> | null) => void,
  ) => {
    const api = await remote();
    const crypto = await loadCrypto();
    const open = async (photoId: string | undefined, sealed: Uint8Array | null) => {
      if (photoId === undefined) return;
      const entry = known.get(photoId);
      const usable = sealed && entry && hasPreview(entry.meta);
      const opened = usable ? await crypto.decryptFile(entry.key, sealed).catch(() => null) : null;
      const plain = opened && new Uint8Array(opened);
      // A file's preview is only ever handed out as the JPEG this app drew.
      deliver(photoId, plain && (entry?.meta.kind !== 'file' || isJpeg(plain)) ? plain : null);
    };
    for (let start = 0; start < photoIds.length; start += THUMB_BATCH_MAX) {
      const ids = photoIds.slice(start, start + THUMB_BATCH_MAX);
      // Previews decrypt one after another, in the order they arrive.
      let decrypting = Promise.resolve();
      const downloading = api.getThumbs(ids, (index, sealed) => {
        decrypting = decrypting.then(() => open(ids[index], sealed));
      });
      await downloading.finally(() => decrypting);
    }
  };

  /**
   * The space's upload key pair, for the owner only: what opens photos a phone backed up
   * while locked. Null when there isn't one or it couldn't be fetched (tried again next time).
   */
  let uploadKey: Promise<UploadKeyPair | null> | null = null;
  const ownerUploadKey = () => {
    if (!('spaceKey' in space)) return Promise.resolve(null);
    uploadKey ??= remote()
      .then((api) => uploadKeyPair(space, api, false))
      .catch(() => {
        uploadKey = null;
        return null;
      });
    return uploadKey;
  };

  /**
   * Seals photos a phone backed up again under the records key, so members and other
   * devices read them the usual way. Best effort: any left over are done next time.
   */
  const adopt = async (photos: { id: string; meta: PhotoMeta }[]) => {
    const api = await remote();
    for (const { id, meta } of photos) {
      // A change made here since (a shared folder's, say) is what gets sealed.
      await sealPhoto(id, known.get(id)?.meta ?? meta)
        .then((sealed) => api.updatePhoto(id, sealed))
        .catch(() => undefined);
    }
  };
  /** Photos being sealed again, which stopping sharing an album waits for. */
  let adopting: Promise<void> = Promise.resolve();

  /**
   * What opens a photo someone given a shared album added to it: that album's key. Waits for
   * the albums to be opened first, when `albumsOpened` is given.
   */
  let albumsOpened: Promise<unknown> = Promise.resolve();

  /** Opens every page of photos `listPage` returns, and remembers their keys. */
  const openPhotos = async (listPage: (after?: string) => Promise<PhotoPage>) => {
    const crypto = await loadCrypto();
    const keys = await access();
    const photos: Photo[] = [];
    const backedUp: { id: string; meta: PhotoMeta }[] = [];
    const open = async (stored: PhotoPage['photos'][number]) => {
      if (stored.sealedForAlbum !== undefined && membership?.album === undefined) {
        await albumsOpened;
        const shared = await sharedAccess(stored.sealedForAlbum);
        return shared && crypto.openRecord(shared, 'photo', stored.id, stored.meta);
      }
      if (!stored.sealedForOwner) return crypto.openRecord(keys, 'photo', stored.id, stored.meta);
      const pair = await ownerUploadKey();
      if (!pair) return null;
      return crypto.openUpload(pair, 'photo', stored.id, stored.meta);
    };
    let after: string | undefined;
    do {
      const page = await listPage(after);
      for (const stored of page.photos) {
        // A record that doesn't open was tampered with or isn't ours: leave it out.
        const opened = await open(stored).catch(() => null);
        let meta = opened && parsePhotoMeta(decodeJson(opened));
        const key = meta && crypto.fromBase64Url(meta.key);
        if (!meta || key?.length !== 32) continue;
        if (stored.sealedForAlbum !== undefined) {
          // Added to a shared album by someone given it: it's in that album only (or, in a
          // shared folder, the folder inside it they put it in), and their fingerprint was
          // taken with the album's key, so it matches nothing here.
          const root = stored.sealedForAlbum;
          const inside = new Set(foldersInside(root).map((folder) => folder.id));
          const filedIn = meta.albumIds.find((id) => inside.has(id)) ?? root;
          meta = { ...meta, favorite: false, albumIds: [filedIn] };
          delete meta.fp;
        }
        known.set(stored.id, { key, meta });
        if (stored.sealedForOwner || stored.sealedForAlbum !== undefined) {
          backedUp.push({ id: stored.id, meta });
        }
        photos.push(toPhoto(stored.id, meta, membership, stored.thumbSize + stored.fullSize));
      }
      after = page.next ?? undefined;
    } while (after);
    // The photos show now; sealing them again carries on behind.
    if (backedUp.length > 0) {
      const previous = adopting;
      adopting = previous.then(() => adopt(backedUp));
    }
    return photos;
  };

  /**
   * Moves known photos into or out of Recently deleted, a batch at a time, with their
   * metadata resealed as `change` makes it. Returns the ids the server moved.
   */
  const moveTrash = async (
    photoIds: readonly string[],
    change: (meta: PhotoMeta) => PhotoMeta,
    send: (photos: { id: string; meta: string }[]) => Promise<{ photoIds: string[] }>,
  ) => {
    const ids = photoIds.filter((photoId) => known.has(photoId));
    const moved: string[] = [];
    for (let start = 0; start < ids.length; start += TRASH_BATCH_MAX) {
      const batch = ids.slice(start, start + TRASH_BATCH_MAX);
      const metas = new Map(batch.map((photoId) => [photoId, change(lookup(photoId).meta)]));
      const sealed = await Promise.all(
        [...metas].map(async ([id, meta]) => ({ id, meta: await sealPhoto(id, meta) })),
      );
      const answer = await send(sealed);
      for (const photoId of answer.photoIds) {
        const entry = known.get(photoId);
        const meta = metas.get(photoId);
        if (entry && meta) known.set(photoId, { ...entry, meta });
        moved.push(photoId);
      }
    }
    return moved;
  };

  /**
   * Takes shared albums out of photos someone given the album took out of it, in their own
   * sealed metadata, and then lets the server forget. Best effort: what's left is done next time.
   */
  const catchUpRemovals = async (removals: { album: string; photoIds: string[] }[]) => {
    const api = await remote();
    const changed = new Set<string>();
    for (const { album, photoIds } of removals) {
      for (const photoId of photoIds) {
        const entry = known.get(photoId);
        const done = async () => {
          if (entry?.meta.albumIds.includes(album)) {
            const meta = {
              ...entry.meta,
              albumIds: entry.meta.albumIds.filter((id) => id !== album),
            };
            await api.updatePhoto(photoId, await sealPhoto(photoId, meta));
            known.set(photoId, { ...entry, meta });
            changed.add(photoId);
          }
          await api.forgetAlbumRemoved(album, photoId);
        };
        await done().catch(() => undefined);
      }
    }
    return changed;
  };

  /** A file of yours with the album row it is shared through, if it is. */
  const withShareId = (photo: Photo): Photo => {
    const shareId = fileShareOf(photo.id);
    return shareId === undefined ? photo : { ...photo, shareId };
  };

  /**
   * What someone given one folder sees: it and what's in it, with the changes still waiting
   * for its owner applied on top.
   */
  const showMemberShare = async (
    root: { id: string; name: string; edits: StoredFolderEdit[] },
    photos: Photo[],
  ) => {
    const share: SharedFolderState = memberShare ?? {
      root: root.id,
      folders: new Map(),
      files: new Map(),
    };
    for (const photo of photos) {
      // Where it was filed, which may be a folder a change still waiting makes.
      const folder = photo.albumIds[0] ?? root.id;
      share.files.set(photo.id, { folder, ...(photo.file && { name: photo.file.name }) });
    }
    const crypto = await loadCrypto();
    const keys = await access();
    for (const stored of root.edits) {
      const edit = await crypto
        .openRecord(keys, 'folder-edit', stored.id, stored.meta)
        .then((opened) => parseFolderEdit(decodeJson(opened)))
        .catch(() => null);
      if (edit) applyFolderEdit(share, edit);
    }
    // Anything filed outside what it holds now shows at its top.
    for (const [id, file] of share.files) {
      if (!inSharedFolder(share, file.folder)) share.files.set(id, { ...file, folder: root.id });
    }
    memberShare = share;
    memberTree = new Set([root.id, ...share.folders.keys()]);
    const shown = photos.flatMap((photo) => {
      const file = share.files.get(photo.id);
      if (!file) return [];
      const entry = known.get(photo.id);
      const name = file.name;
      if (entry) {
        const meta = { ...entry.meta, albumIds: [file.folder] };
        if (name !== undefined) meta.name = name;
        known.set(photo.id, { ...entry, meta });
      }
      return [
        {
          ...photo,
          albumIds: [file.folder],
          ...(photo.file && name !== undefined && { file: { ...photo.file, name } }),
        },
      ];
    });
    const folders: Folder[] = [
      { id: root.id, name: root.name },
      ...[...share.folders].map(([id, folder]) => ({
        id,
        name: folder.name,
        parentId: folder.parent,
      })),
    ];
    return { photos: shown, folders };
  };

  /**
   * Makes a change inside the folder shared with you, if it still makes sense there: it
   * waits, sealed under the folder's key, for the owner's device to make it, and everyone
   * given the folder sees it until then.
   */
  const memberEdit = async (edit: FolderEdit) => {
    const share = memberShare;
    if (membership?.album === undefined || !share) throw new FormError(ALBUM_ONLY);
    if (memberFile && !changesOneFile(edit)) throw new FormError(FILE_ONLY);
    const next: SharedFolderState = {
      root: share.root,
      folders: new Map(share.folders),
      files: new Map(share.files),
    };
    if (!applyFolderEdit(next, edit)) throw new FormError(NOT_HERE);
    const crypto = await loadCrypto();
    const id = await crypto.newRecordId();
    const sealed = await crypto.sealRecord(await access(), 'folder-edit', id, encodeJson(edit));
    const api = await remote();
    await api.addFolderEdit(share.root, { id, meta: sealed });
    memberShare = next;
    memberTree = new Set([next.root, ...next.folders.keys()]);
  };

  const store: SpaceStore = {
    list: async () => {
      const api = await remote();
      const crypto = await loadCrypto();
      const keys = await access();
      // Albums are asked for alongside the photos, not after them.
      const storedAlbums = api.listAlbums();
      storedAlbums.catch(() => undefined);
      const albums: Album[] = [];
      let folders: Folder[] = [];
      const removals: { album: string; photoIds: string[] }[] = [];
      // Set (as the albums open) when only one folder is shared with you.
      const sharedRoot: { at: { id: string; name: string; edits: StoredFolderEdit[] } | null } = {
        at: null,
      };
      waitingEdits = [];
      const opening = storedAlbums.then(async ({ albums: stored }) => {
        for (const each of stored) {
          const opened = await crypto
            .openRecord(keys, 'album', each.id, each.meta)
            .catch(() => null);
          const plain = opened && decodeJson(opened);
          // Someone given one file sees its name from its shared record, and the file.
          const sharedFile = membership?.album === undefined ? null : parseSharedFileMeta(plain);
          if (sharedFile) {
            sharedRoot.at = { id: each.id, name: sharedFile.name, edits: each.edits ?? [] };
            memberFile = true;
            memberShare = { root: each.id, folders: new Map(), files: new Map() };
            memberTree = new Set([each.id]);
            continue;
          }
          // Someone given one folder sees it, and the folders inside it, from its shared record.
          const shared = membership?.album === undefined ? null : parseFolderShareMeta(plain);
          if (shared) {
            memberFile = false;
            sharedRoot.at = { id: each.id, name: shared.name, edits: each.edits ?? [] };
            memberShare = {
              root: each.id,
              folders: new Map(
                shared.folders.map((inside) => [
                  inside.id,
                  { name: inside.name, parent: inside.parent },
                ]),
              ),
              files: new Map(),
            };
            memberTree = new Set([each.id, ...memberShare.folders.keys()]);
            continue;
          }
          const fileShare = parseFileShareMeta(plain);
          if (fileShare) {
            fileShares.set(each.id, fileShare);
            if (fileShare.shareKey && each.edits && each.edits.length > 0) {
              waitingEdits.push({ root: each.id, edits: each.edits });
            }
            continue;
          }
          const folder = parseFolderMeta(plain);
          if (folder) {
            folderMetas.set(each.id, folder);
            folders.push(toFolder(each.id, folder));
            if (folder.shareKey && each.edits && each.edits.length > 0) {
              waitingEdits.push({ root: each.id, edits: each.edits });
            }
            continue;
          }
          const meta = parseAlbumMeta(plain);
          if (!meta) continue;
          albumMetas.set(each.id, meta);
          albums.push({ id: each.id, title: meta.title });
          if (each.removed && each.removed.length > 0) {
            removals.push({ album: each.id, photoIds: each.removed });
          }
        }
        // New folders people given yours made are made before files that went in them open.
        if (await makeEdits('folders')) {
          folders = [...folderMetas].map(([id, meta]) => toFolder(id, meta));
        }
      });
      // Photos added to a shared album by someone given it open with the album's key.
      albumsOpened = opening.catch(() => undefined);
      let photos = await openPhotos((after) => api.listPhotos(after));
      await opening;
      const root = sharedRoot.at;
      if (root !== null) {
        const shown = await showMemberShare(root, photos);
        if (!memberFile) return { photos: shown.photos, albums, folders: shown.folders };
        // One file shared on its own: it is the only thing here, and in no folder.
        return {
          photos: shown.photos.map((photo) => ({ ...photo, albumIds: [], sharedFile: true })),
          albums,
          folders: [],
        };
      }
      const changed = removals.length === 0 ? new Set<string>() : await catchUpRemovals(removals);
      if (waitingEdits.some((waiting) => waiting.edits.length > 0)) {
        // What it changes is sealed again here, so photos being sealed again go first.
        await adopting;
        if (await makeEdits('files')) {
          folders = [...folderMetas].map(([id, meta]) => toFolder(id, meta));
          for (const photo of photos) changed.add(photo.id);
        }
      }
      for (const rootId of editedShares) await syncShare(rootId).catch(() => undefined);
      editedShares.clear();
      if (changed.size > 0) {
        photos = photos.flatMap((photo) => {
          const entry = known.get(photo.id);
          if (!changed.has(photo.id) || !entry) return [photo];
          // Deleted inside a shared folder by someone given it: it's in Recently deleted now.
          if (entry.meta.deletedAt !== undefined) return [];
          return [toPhoto(photo.id, entry.meta, membership, photo.size ?? 0, photo.src)];
        });
      }
      return { photos: photos.map(withShareId), albums, folders };
    },

    image: async (photoId, part) => {
      const cached = urls.get(`${photoId}/${part}`);
      if (cached) return cached;
      // A file is never shown as an image: an HTML or SVG file opened from an object URL
      // could run its script inside the app. Only a preview this app drew (a JPEG) is shown.
      const meta = lookup(photoId).meta;
      if (meta.kind === 'file' && (part === 'full' || !meta.preview)) {
        throw new FormError(NOT_A_PHOTO);
      }
      const { plain, entry } = await decrypt(photoId, part);
      if (meta.kind === 'file' && !isJpeg(plain)) throw new FormError(NOT_A_PHOTO);
      if (part === 'full') {
        // Originals can be large, so only the latest one stays decrypted in memory.
        for (const [name, url] of urls) {
          if (name.endsWith('/full') || name.endsWith('/view')) {
            platform.releaseImage(url);
            urls.delete(name);
          }
        }
        const copy = await platform.viewableCopy(plain, entry.meta.type);
        if (copy) track(photoId, 'view', copy, THUMB_TYPE);
      }
      return track(photoId, part, plain, part === 'thumb' ? THUMB_TYPE : entry.meta.type);
    },

    viewImage: (photoId) => urls.get(`${photoId}/view`),

    thumbs: async (photoIds, onThumb) => {
      const found = new Map<string, string>();
      const missing: string[] = [];
      for (const photoId of photoIds) {
        const cached = urls.get(`${photoId}/thumb`);
        if (cached) found.set(photoId, cached);
        else if (known.has(photoId)) missing.push(photoId);
      }
      if (missing.length === 0) return found;
      // Photos the server answered for, with a preview or without one: not worth asking again.
      const answered = new Set<string>();
      try {
        await downloadThumbs(missing, (photoId, plain) => {
          answered.add(photoId);
          // A preview that doesn't decrypt was tampered with: it stays a placeholder.
          if (!plain) return;
          const url = track(photoId, 'thumb', plain, THUMB_TYPE);
          found.set(photoId, url);
          onThumb?.(photoId, url);
        });
      } catch (error) {
        const failed = missing.filter((photoId) => !answered.has(photoId));
        if (answered.size === 0) throw error;
        throw new PartialThumbs(found, failed);
      }
      return found;
    },

    previews: async (photoIds, onPreview) => {
      const ids = photoIds.filter((photoId) => known.has(photoId));
      for (const photoId of photoIds) if (!known.has(photoId)) onPreview(photoId, null);
      if (ids.length > 0) await downloadThumbs(ids, onPreview);
    },

    add: async (photo, albumIds, onStage) => {
      const crypto = await loadCrypto();
      const file = photo.file;
      if (file ? cleanFileType(photo.type) !== photo.type : !isPhotoType(photo.type)) {
        throw new FormError('Arcafold can’t store this kind of file.');
      }
      const tooLarge = file ? FILE_TOO_LARGE : TOO_LARGE;
      if (crypto.encryptedFileSize(photo.full.length) > STORAGE_SIZES.maxFull) {
        throw new FormError(tooLarge);
      }
      onStage?.('encrypting');
      const id = await crypto.newRecordId();
      const key = await crypto.newFileKey();
      const thumb = new Uint8Array(await crypto.encryptFile(key, photo.thumb));
      const full = new Uint8Array(await crypto.encryptLargeFile(key, photo.full));
      if (thumb.length > STORAGE_SIZES.maxThumb) throw new FormError(tooLarge);
      const meta: PhotoMeta = {
        v: 1,
        key: crypto.toBase64Url(key),
        type: photo.type,
        width: photo.width,
        height: photo.height,
        takenAt: photo.takenAt,
        favorite: photo.favorite ?? false,
        albumIds,
        fp: await crypto.photoFingerprint(await access(), photo.full),
      };
      if (file) {
        meta.kind = 'file';
        meta.name = file.name;
        meta.bytes = photo.full.length;
        if (file.preview) meta.preview = true;
        if (file.category) meta.category = file.category;
        if (file.words && file.words.length > 0) meta.words = file.words;
        if (file.sortedByYou) meta.sorted = 'you';
      }
      if (membership) meta.by = { id: membership.memberId, name: membership.myName };
      const album = membership?.album;
      // Someone given one album adds to it only, and keeps nothing else about the photo there.
      if (album !== undefined) {
        meta.favorite = false;
        // In a shared folder, it can go in any folder inside it.
        const filedIn = albumIds[0];
        meta.albumIds = [filedIn !== undefined && memberTree.has(filedIn) ? filedIn : album];
        delete meta.words;
        delete meta.sorted;
      }
      const api = await remote();
      onStage?.('uploading');
      const sealed = await sealPhoto(id, meta);
      await api.createPhoto({ id, meta: sealed, thumbSize: thumb.length, fullSize: full.length });
      try {
        // Both files go up together. Whichever lands second commits the photo; only if
        // neither saw the other is a separate commit needed. Both settle before any cleanup,
        // so a file still on its way can't land after the photo is let go.
        const puts = await Promise.allSettled([
          api.putFile(id, 'thumb', thumb),
          api.putFile(id, 'full', full),
        ]);
        const failed = puts.find((put) => put.status === 'rejected');
        if (failed) throw failed.reason;
        const committed = puts.some((put) => put.status === 'fulfilled' && put.value.committed);
        if (!committed) await api.commitPhoto(id);
      } catch (error) {
        // Let the half-finished upload go now, so its space comes back to this account.
        await api.deletePhoto(id).catch(() => undefined);
        throw error;
      }
      known.set(id, { key, meta });
      // Sealed under the album key already, so the same record is what the album lists.
      if (album !== undefined) {
        await api.putAlbumItem(album, id, sealed);
        const folder = meta.albumIds[0] ?? album;
        memberShare?.files.set(id, { folder, ...(meta.name !== undefined && { name: meta.name }) });
      } else await syncShared(id, [], albumIds);
      return toPhoto(
        id,
        meta,
        membership,
        thumb.length + full.length,
        // A file's stand-in preview is never shown; a drawn one is, like a photo's.
        file && !meta.preview ? '' : track(id, 'thumb', photo.thumb, THUMB_TYPE),
      );
    },

    update: async (photo) => {
      const entry = lookup(photo.id);
      const album = membership?.album;
      const share = memberShare;
      if (album !== undefined && share) {
        // In a folder shared with you, a file can be renamed or moved inside it.
        const current = share.files.get(photo.id);
        if (!current) throw new FormError(NOT_HERE);
        // A file shared on its own is in no folder of yours, and stays where it is.
        const folder = memberFile
          ? share.root
          : photo.albumIds.find((id) => inSharedFolder(share, id));
        if (folder === undefined) throw new FormError(STAYS_SHARED);
        const name = photo.file && cleanFileName(photo.file.name);
        if (name !== undefined && current.name !== undefined && name !== current.name) {
          await memberEdit({ v: 1, op: 'rename-file', file: photo.id, name });
        }
        if (folder !== current.folder) {
          await memberEdit({ v: 1, op: 'move-file', file: photo.id, folder });
        }
        const meta: PhotoMeta = { ...entry.meta, albumIds: [folder] };
        if (name !== undefined && entry.meta.kind === 'file') meta.name = name;
        known.set(photo.id, { ...entry, meta });
        return;
      }
      if (album !== undefined) {
        // In an album shared with you, the only change is taking a photo out of it.
        if (photo.albumIds.includes(album)) throw new FormError(ALBUM_ONLY);
        const api = await remote();
        await api.deleteAlbumItem(album, photo.id);
        forget(photo.id);
        return;
      }
      const meta: PhotoMeta = { ...entry.meta, favorite: photo.favorite, albumIds: photo.albumIds };
      if (entry.meta.kind === 'file' && photo.file && photo.file.name !== entry.meta.name) {
        meta.name = cleanFileName(photo.file.name);
      }
      const category = photo.file?.category;
      if (entry.meta.kind === 'file' && category && photo.file?.sortedByYou) {
        meta.category = category;
        meta.sorted = 'you';
      }
      const api = await remote();
      await api.updatePhoto(photo.id, await sealPhoto(photo.id, meta));
      known.set(photo.id, { ...entry, meta });
      await syncShared(photo.id, entry.meta.albumIds, meta.albumIds);
      // Shared on its own, its people see its new name.
      const row = fileShareOf(photo.id);
      if (row !== undefined) await syncFileShare(row).catch(() => undefined);
    },

    remove: async (photoId) => {
      const api = await remote();
      await api.deletePhoto(photoId);
      forget(photoId);
      // Sharing it on its own ends with it.
      const row = fileShareOf(photoId);
      if (row !== undefined) {
        await api.deleteAlbum(row).catch(() => undefined);
        fileShares.delete(row);
      }
    },

    shareFile: async (photoId) => {
      const existing = fileShareOf(photoId);
      if (existing !== undefined) return existing;
      const entry = lookup(photoId);
      if (entry.meta.kind !== 'file' || membership !== null) throw new FormError(NOT_YOURS_FILE);
      const crypto = await loadCrypto();
      const id = await crypto.newRecordId();
      const meta: FileShareMeta = { v: 1, kind: 'file-share', file: photoId };
      const api = await remote();
      await api.createAlbum({ id, meta: await sealAlbum(id, meta) });
      fileShares.set(id, meta);
      return id;
    },

    replaceFile: async (photoId, photo) => {
      const share = memberShare;
      if (membership?.album === undefined || !share || !memberFile) {
        throw new FormError(FILE_ONLY);
      }
      if (!photo.file) throw new FormError(FILE_ONLY);
      const added = await store.add(photo, [share.root]);
      await memberEdit({ v: 1, op: 'replace-file', file: photoId, by: added.id });
      return { ...added, albumIds: [], sharedFile: true };
    },

    listTrash: async () => {
      const api = await remote();
      return openPhotos((after) => api.listTrash(after));
    },

    trash: async (photoIds, deletedAt) => {
      if (membership?.album !== undefined && memberShare) {
        // Deleted inside a folder shared with you: it goes to its owner's Recently deleted.
        const done: string[] = [];
        for (const photoId of photoIds) {
          await memberEdit({ v: 1, op: 'delete-file', file: photoId, at: deletedAt });
          done.push(photoId);
        }
        return done;
      }
      const api = await remote();
      return moveTrash(photoIds, (meta) => ({ ...meta, deletedAt }), api.trashPhotos);
    },

    restore: async (photoIds) => {
      const api = await remote();
      return moveTrash(
        photoIds,
        (meta) => {
          const rest = { ...meta };
          delete rest.deletedAt;
          return rest;
        },
        api.restorePhotos,
      );
    },

    createAlbum: async (title) => {
      const crypto = await loadCrypto();
      const id = await crypto.newRecordId();
      const meta: AlbumMeta = { v: 1, title };
      const api = await remote();
      await api.createAlbum({ id, meta: await sealAlbum(id, meta) });
      albumMetas.set(id, meta);
      return { id, title };
    },

    renameAlbum: async (albumId, title) => {
      const crypto = await loadCrypto();
      // Keep the album's share key, if it has one.
      const meta: AlbumMeta = { ...(albumMetas.get(albumId) ?? { v: 1 }), title };
      const api = await remote();
      await api.updateAlbum(albumId, await sealAlbum(albumId, meta));
      albumMetas.set(albumId, meta);
      const shared = await sharedAccess(albumId);
      if (shared) {
        await api.shareAlbum(
          albumId,
          await crypto.sealRecord(shared, 'album', albumId, encodeJson({ v: 1, title })),
        );
      }
    },

    removeAlbum: async (albumId) => {
      // Photos added to it by people it was shared with must be sealed again before its key goes.
      await adopting;
      const api = await remote();
      await api.deleteAlbum(albumId);
      albumMetas.delete(albumId);
      folderMetas.delete(albumId);
    },

    createFolder: async (name, parentId) => {
      const crypto = await loadCrypto();
      const id = await crypto.newRecordId();
      if (membership?.album !== undefined) {
        const share = memberShare;
        if (!share) throw new FormError(ALBUM_ONLY);
        const parent = parentId ?? share.root;
        const made = folderName(name);
        await memberEdit({ v: 1, op: 'make-folder', id, name: made, parent });
        return { id, name: made, parentId: parent };
      }
      const meta: FolderMeta = {
        v: 1,
        kind: 'folder',
        name: folderName(name),
        ...(parentId !== undefined && { parent: parentId }),
      };
      const api = await remote();
      await api.createAlbum({ id, meta: await sealAlbum(id, meta) });
      folderMetas.set(id, meta);
      await refreshShares([id]);
      return toFolder(id, meta);
    },

    saveFolder: async (folder) => {
      if (membership?.album !== undefined) {
        const share = memberShare;
        if (!share) throw new FormError(ALBUM_ONLY);
        if (folder.id === share.root) throw new FormError(OWNER_ONLY_FOLDER);
        const current = share.folders.get(folder.id);
        if (!current) {
          // Already gone along with the folder it was in.
          if (folder.deletedAt !== undefined) return;
          throw new FormError(FOLDER_GONE);
        }
        if (folder.deletedAt !== undefined) {
          await memberEdit({ v: 1, op: 'delete-folder', id: folder.id, at: folder.deletedAt });
          return;
        }
        const name = folderName(folder.name);
        if (name !== current.name) {
          await memberEdit({ v: 1, op: 'rename-folder', id: folder.id, name });
        }
        if (folder.parentId === undefined) throw new FormError(STAYS_SHARED);
        if (folder.parentId !== current.parent) {
          await memberEdit({ v: 1, op: 'move-folder', id: folder.id, parent: folder.parentId });
        }
        return;
      }
      const current = folderMetas.get(folder.id);
      if (!current) throw new FormError(FOLDER_GONE);
      // Keep its share key, if it has one.
      const meta: FolderMeta = {
        v: 1,
        kind: 'folder',
        name: folderName(folder.name),
        ...(folder.parentId !== undefined && { parent: folder.parentId }),
        ...(folder.deletedAt !== undefined && { deletedAt: folder.deletedAt }),
        ...(current.shareKey !== undefined && { shareKey: current.shareKey }),
      };
      const before = sharesOf([folder.id]);
      await writeFolder(folder.id, meta);
      // Its name, where it is, or whether it's deleted can change what shared folders hold.
      before.delete(folder.id);
      await refreshShares([...before.keys(), folder.id]);
    },

    shareAlbum: async (albumId) => {
      const crypto = await loadCrypto();
      const api = await remote();
      const single = fileShares.get(albumId);
      if (single) {
        if (!single.shareKey) {
          const keyed: FileShareMeta = {
            ...single,
            shareKey: crypto.toBase64Url(await crypto.newAlbumKey()),
          };
          await api.updateAlbum(albumId, await sealAlbum(albumId, keyed));
          fileShares.set(albumId, keyed);
        }
        await syncFileShare(albumId);
        const shared = await sharedAccess(albumId);
        if (!shared) throw new FormError(FILE_GONE);
        return shared.recordKey;
      }
      const folder = folderMetas.get(albumId);
      if (folder) {
        if (folder.deletedAt !== undefined) throw new FormError(FOLDER_GONE);
        if (!folder.shareKey) {
          const shared: FolderMeta = {
            ...folder,
            shareKey: crypto.toBase64Url(await crypto.newAlbumKey()),
          };
          await api.updateAlbum(albumId, await sealAlbum(albumId, shared));
          folderMetas.set(albumId, shared);
        }
        await syncFolderShare(albumId);
        const shared = await sharedAccess(albumId);
        if (!shared) throw new FormError(FOLDER_GONE);
        return shared.recordKey;
      }
      let meta = albumMetas.get(albumId);
      if (!meta) throw new FormError(ALBUM_GONE);
      if (!meta.shareKey) {
        meta = { ...meta, shareKey: crypto.toBase64Url(await crypto.newAlbumKey()) };
        await api.updateAlbum(albumId, await sealAlbum(albumId, meta));
        albumMetas.set(albumId, meta);
      }
      const shared = await sharedAccess(albumId);
      if (!shared) throw new FormError(ALBUM_GONE);
      await api.shareAlbum(
        albumId,
        await crypto.sealRecord(shared, 'album', albumId, encodeJson({ v: 1, title: meta.title })),
      );
      // List what's missing and unlist what left, whatever happened since it was last shared.
      const listed = new Set((await api.listAlbumItems(albumId)).photoIds);
      const filed = [...known]
        .filter(([, entry]) => entry.meta.albumIds.includes(albumId))
        .map(([id]) => id);
      for (const photoId of filed) {
        if (!listed.has(photoId)) await listInAlbum(shared, albumId, photoId);
        listed.delete(photoId);
      }
      for (const photoId of listed) await api.deleteAlbumItem(albumId, photoId);
      return shared.recordKey;
    },

    stopSharingAlbum: async (albumId) => {
      if (fileShares.has(albumId)) {
        // A file shared on its own has nothing to keep: sharing it again starts afresh.
        await adopting;
        const api = await remote();
        await api.deleteAlbum(albumId);
        fileShares.delete(albumId);
        return;
      }
      // Photos added to it by people it was shared with must be sealed again before its key goes.
      await adopting;
      const api = await remote();
      const folder = folderMetas.get(albumId);
      if (folder) {
        await api.unshareAlbum(albumId);
        if (!folder.shareKey) return;
        // Sharing it again makes a new key.
        const meta: FolderMeta = { ...folder };
        delete meta.shareKey;
        await api.updateAlbum(albumId, await sealAlbum(albumId, meta));
        folderMetas.set(albumId, meta);
        return;
      }
      const current = albumMetas.get(albumId);
      if (!current) throw new FormError(ALBUM_GONE);
      await api.unshareAlbum(albumId);
      if (!current.shareKey) return;
      // A new share gets a new key, so nobody who had this one can read what comes after.
      const meta: AlbumMeta = { v: 1, title: current.title };
      await api.updateAlbum(albumId, await sealAlbum(albumId, meta));
      albumMetas.set(albumId, meta);
    },

    read: async (photoId) => {
      const { plain: full, entry } = await decrypt(photoId, 'full');
      const { plain: thumb } = await decrypt(photoId, 'thumb');
      const { type, width, height, takenAt } = entry.meta;
      const file = fileOf(entry.meta);
      return {
        thumb,
        full,
        type,
        width,
        height,
        takenAt,
        ...(file && {
          file: {
            name: file.name,
            ...(file.preview && { preview: true }),
            ...(file.category && { category: file.category }),
            ...(file.words && { words: file.words }),
            ...(file.sortedByYou && { sortedByYou: true }),
          },
        }),
      };
    },

    original: async (photoId) => {
      const { plain: full, entry } = await decrypt(photoId, 'full');
      const file = fileOf(entry.meta);
      return {
        full,
        type: entry.meta.type,
        takenAt: entry.meta.takenAt,
        ...(file && { name: file.name }),
      };
    },

    fingerprint: async (original) => {
      const crypto = await loadCrypto();
      return crypto.photoFingerprint(await access(), original);
    },

    fingerprints: () => {
      const found = new Map<string, string>();
      for (const [photoId, { meta }] of known)
        if (meta.fp !== undefined) found.set(meta.fp, photoId);
      return found;
    },

    stamp: async () => (await (await remote()).stamp()).stamp,

    dispose: () => {
      for (const url of urls.values()) platform.releaseImage(url);
      urls.clear();
      void uploadKey?.then((pair) => pair?.secretKey.fill(0));
      uploadKey = null;
    },
  };
  return store;
}

/** A library or album someone shared with this space, and the store that reaches it. */
export interface SharedSource {
  id: string;
  /** Whose library it is. */
  name: string;
  /**
   * Set when only one album was shared. Even if you may edit it, you can only add photos to
   * it and take photos out of it.
   */
  album?: boolean;
  /**
   * Whether its owner lets you add and change things there. Left out, you can. The server
   * enforces it either way; this only keeps the app from offering what would be refused.
   */
  editable?: Promise<boolean>;
  store: SpaceStore;
}

const NOT_YOURS = 'Only the person whose album this is can share it.';
export const VIEW_ONLY_LIBRARY = 'You can view this library, but not change it.';

/**
 * Your own space plus every library it has joined, as one store. Photos and albums from a
 * joined library carry its owner's name in `library`, and every change goes to the store
 * the photo or album came from. New photos go to your own space, unless they're filed in
 * a shared album. A library that fails to load is left out rather than hiding the rest.
 */
export function combinedStore(
  own: SpaceStore,
  loadShared: () => Promise<SharedSource[]>,
): SpaceStore {
  let shared: SharedSource[] = [];
  /** The stores of libraries and albums you can only view. */
  const readOnly = new Set<SpaceStore>();
  /** The stores of single albums shared with you that you may add to and take out of. */
  const albumOnly = new Set<SpaceStore>();
  const changeable = (store: SpaceStore) => {
    if (readOnly.has(store)) throw new FormError(VIEW_ONLY_LIBRARY);
    return store;
  };
  /** The stores of single folders shared with you that you may add to and change inside. */
  const folderOnly = new Set<SpaceStore>();
  /** For changes beyond adding to an album and taking photos out of it. */
  const ownedChange = (store: SpaceStore) => {
    if (albumOnly.has(store)) throw new FormError(ALBUM_ONLY);
    return changeable(store);
  };
  /** For changes to folders and files, which a folder shared with you to edit takes too. */
  const folderChange = (store: SpaceStore) =>
    folderOnly.has(store) ? changeable(store) : ownedChange(store);
  const photoStores = new Map<string, SpaceStore>();
  const albumStores = new Map<string, SpaceStore>();
  const storeOf = (photoId: string) => photoStores.get(photoId) ?? own;
  /** Runs `task` once per store, with the photos that live there, and joins the answers. */
  const eachStore = async (
    photoIds: readonly string[],
    task: (store: SpaceStore, ids: string[]) => Promise<string[]>,
  ) => {
    const byStore = new Map<SpaceStore, string[]>();
    for (const photoId of photoIds) {
      const store = storeOf(photoId);
      byStore.set(store, [...(byStore.get(store) ?? []), photoId]);
    }
    const answers = await Promise.all([...byStore].map(([store, ids]) => task(store, ids)));
    return answers.flat();
  };
  const albumStoreOf = (albumId: string) => albumStores.get(albumId) ?? own;

  return {
    list: async () => {
      // Your own library and every shared one load at the same time.
      const sharedLists = loadShared()
        .catch(() => [])
        .then((sources) =>
          Promise.all(
            sources.map(async (source) => {
              const editable = (source.editable ?? Promise.resolve(true)).catch(() => false);
              const loaded = await source.store.list().catch(() => null);
              return { source, loaded, viewOnly: !(await editable) };
            }),
          ),
        );
      const mine = await own.list();
      const loadedShared = await sharedLists;
      shared = loadedShared.map(({ source }) => source);
      readOnly.clear();
      albumOnly.clear();
      folderOnly.clear();
      // Listing again starts afresh: what each share holds may have changed since.
      photoStores.clear();
      albumStores.clear();
      for (const { source, loaded, viewOnly } of loadedShared) {
        if (viewOnly) readOnly.add(source.store);
        else if (source.album) albumOnly.add(source.store);
        if (!viewOnly && source.album && loaded && loaded.folders.length > 0) {
          folderOnly.add(source.store);
        }
      }
      const photos = [...mine.photos];
      const albums = [...mine.albums];
      const folders = [...mine.folders];
      const seen = new Map(photos.map((photo, index) => [photo.id, index]));
      for (const { source, loaded, viewOnly } of loadedShared) {
        if (!loaded) continue;
        const marks = {
          library: source.name,
          ...(source.album && { sharedAlbum: true }),
          ...(viewOnly && { viewOnly: true }),
        };
        const albumMarks = source.album ? { ...marks, joinedId: source.id } : marks;
        for (const photo of loaded.photos) {
          const index = seen.get(photo.id);
          const existing = index === undefined ? undefined : photos[index];
          if (index !== undefined && existing) {
            // Already here through another share: it's in this album too.
            const albumIds = [...new Set([...existing.albumIds, ...photo.albumIds])];
            photos[index] = { ...existing, albumIds };
            continue;
          }
          seen.set(photo.id, photos.length);
          photoStores.set(photo.id, source.store);
          photos.push({
            ...photo,
            ...marks,
            // One file shared on its own is left from the file itself.
            ...(source.album && photo.sharedFile && { joinedId: source.id }),
          });
        }
        for (const album of loaded.albums) {
          if (albumStores.has(album.id)) continue;
          albumStores.set(album.id, source.store);
          albums.push({ ...album, ...albumMarks });
        }
        // Folders of a library shared with you whole, or a folder shared on its own (with the
        // folders inside it; the shared one is the one with no parent).
        for (const folder of loaded.folders) {
          if (albumStores.has(folder.id)) continue;
          albumStores.set(folder.id, source.store);
          folders.push({
            ...folder,
            library: source.name,
            ...(viewOnly && { viewOnly: true }),
            ...(source.album && { sharedFolder: true }),
            ...(source.album && folder.parentId === undefined && { joinedId: source.id }),
          });
        }
      }
      return { photos, albums, folders };
    },
    image: (photoId, part) => storeOf(photoId).image(photoId, part),
    viewImage: (photoId) => storeOf(photoId).viewImage(photoId),
    thumbs: async (photoIds, onThumb) => {
      const byStore = new Map<SpaceStore, string[]>();
      for (const photoId of photoIds) {
        const store = storeOf(photoId);
        byStore.set(store, [...(byStore.get(store) ?? []), photoId]);
      }
      const found = new Map<string, string>();
      const failed: string[] = [];
      await Promise.all(
        [...byStore].map(([store, ids]) =>
          store.thumbs(ids, onThumb).then(
            (urls) => {
              for (const [id, url] of urls) found.set(id, url);
            },
            (error: unknown) => {
              if (!(error instanceof PartialThumbs)) {
                failed.push(...ids);
                return;
              }
              for (const [id, url] of error.found) found.set(id, url);
              failed.push(...error.failed);
            },
          ),
        ),
      );
      // Failures must reach the loader, or those tiles would never be tried again.
      if (failed.length > 0) throw new PartialThumbs(found, failed);
      return found;
    },
    previews: async (photoIds, onPreview) => {
      const byStore = new Map<SpaceStore, string[]>();
      for (const photoId of photoIds) {
        const store = storeOf(photoId);
        byStore.set(store, [...(byStore.get(store) ?? []), photoId]);
      }
      await Promise.all([...byStore].map(([store, ids]) => store.previews(ids, onPreview)));
    },
    add: async (photo, albumIds, onStage) => {
      const albumStore = albumIds[0] === undefined ? undefined : albumStores.get(albumIds[0]);
      const target = changeable(albumStore ?? own);
      const added = await target.add(photo, albumIds, onStage);
      if (target === own) return added;
      photoStores.set(added.id, target);
      const source = shared.find((candidate) => candidate.store === target);
      if (!source) return added;
      // Marked like the rest of where it went, so an album's photo stays out of your timeline.
      return { ...added, library: source.name, ...(source.album && { sharedAlbum: true }) };
    },
    update: async (photo) => changeable(storeOf(photo.id)).update(photo),
    remove: async (photoId) => {
      await ownedChange(storeOf(photoId)).remove(photoId);
      photoStores.delete(photoId);
    },
    listTrash: async () => {
      // Libraries you can only view, and albums, keep their Recently deleted to themselves.
      const sources = shared.filter(
        (source) => !readOnly.has(source.store) && !albumOnly.has(source.store),
      );
      const [mine, ...theirs] = await Promise.all([
        own.listTrash(),
        ...sources.map((source) => source.store.listTrash().catch(() => [])),
      ]);
      const photos = [...mine];
      sources.forEach((source, index) => {
        for (const photo of theirs[index] ?? []) {
          photoStores.set(photo.id, source.store);
          photos.push({ ...photo, library: source.name });
        }
      });
      return photos;
    },
    trash: (photoIds, deletedAt) =>
      eachStore(photoIds, (store, ids) => folderChange(store).trash(ids, deletedAt)),
    restore: (photoIds) => eachStore(photoIds, (store, ids) => ownedChange(store).restore(ids)),
    createAlbum: (title) => own.createAlbum(title),
    renameAlbum: async (albumId, title) =>
      ownedChange(albumStoreOf(albumId)).renameAlbum(albumId, title),
    removeAlbum: async (albumId) => {
      await ownedChange(albumStoreOf(albumId)).removeAlbum(albumId);
      albumStores.delete(albumId);
    },
    createFolder: async (name, parentId) => {
      // A folder inside a library you joined is made there, if you may change it.
      const target = parentId === undefined ? own : folderChange(albumStoreOf(parentId));
      const folder = await target.createFolder(name, parentId);
      if (target === own) return folder;
      albumStores.set(folder.id, target);
      const source = shared.find((candidate) => candidate.store === target);
      if (!source) return folder;
      return { ...folder, library: source.name, ...(source.album && { sharedFolder: true }) };
    },
    saveFolder: async (folder) => folderChange(albumStoreOf(folder.id)).saveFolder(folder),
    shareFile: (photoId) =>
      photoStores.has(photoId)
        ? Promise.reject(new FormError(NOT_YOURS_FILE))
        : own.shareFile(photoId),
    replaceFile: async (photoId, photo) => {
      const target = changeable(storeOf(photoId));
      const added = await target.replaceFile(photoId, photo);
      photoStores.set(added.id, target);
      const source = shared.find((candidate) => candidate.store === target);
      if (!source) return added;
      return { ...added, library: source.name, sharedAlbum: true, joinedId: source.id };
    },
    // Only a space's owner can say who it's shared with, so only your own albums are shared.
    shareAlbum: (albumId) =>
      albumStores.has(albumId) ? Promise.reject(new FormError(NOT_YOURS)) : own.shareAlbum(albumId),
    stopSharingAlbum: (albumId) =>
      albumStores.has(albumId)
        ? Promise.reject(new FormError(NOT_YOURS))
        : own.stopSharingAlbum(albumId),
    read: (photoId) => storeOf(photoId).read(photoId),
    original: (photoId) => storeOf(photoId).original(photoId),
    // Imports go to your own library.
    fingerprint: (original) => own.fingerprint(original),
    fingerprints: () => own.fingerprints(),
    // A share that can't be asked any more (it was stopped) reads as changed, so it's dropped.
    stamp: async () =>
      (
        await Promise.all([
          own.stamp(),
          ...shared.map((source) => source.store.stamp().catch(() => 'gone')),
        ])
      ).join('.'),
    dispose: () => {
      own.dispose();
      for (const source of shared) source.store.dispose();
    },
  };
}
