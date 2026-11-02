import type { SpaceAccess, SpaceKeys } from '@arcafold/crypto';
import { STORAGE_SIZES, THUMB_BATCH_MAX, TRASH_BATCH_MAX } from '@arcafold/types';
import type { PhotoPage, PhotoPart } from '@arcafold/types';

import { spaceApi } from '../lib/api';
import { isPhotoType } from '../lib/photo-types';
import { viewableCopy } from '../lib/thumbnail-service';
import type { SpaceApi } from '../lib/api';
import type { Album, Photo } from '../mock/data';
import { FormError } from './account-ops';
import { PartialThumbs } from './thumb-loader';

/**
 * One space's photos and albums, stored encrypted on the server. Every photo has its own
 * key, kept inside the photo's sealed metadata; the metadata and albums are sealed under the
 * space key. Decrypted images only ever exist as in-memory object URLs, revoked on dispose.
 */

let fileCryptoChosen = false;

const loadCrypto = async () => {
  const crypto = await import('@arcafold/crypto');
  // Originals encrypt and decrypt in a Web Worker so a large one doesn't freeze the page.
  if (!fileCryptoChosen && typeof Worker !== 'undefined') {
    fileCryptoChosen = true;
    const { spawnFileCryptoWorker } = await import('../lib/file-crypto-worker');
    crypto.setFileCrypto(crypto.workerFileCrypto(spawnFileCryptoWorker));
  }
  return crypto;
};

/** A photo's decrypted original and what's needed to save a copy of it. */
export interface Original {
  /** The original file, byte for byte. */
  full: Uint8Array<ArrayBuffer>;
  /** The original's media type. */
  type: string;
  takenAt: string;
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
}

/** Where an upload is: encrypting on this device, then sending ciphertext. */
export type UploadStage = 'encrypting' | 'uploading';

export interface SpaceStore {
  /** Every photo and album. Photos come without images (`src` is empty) until `image`. */
  list: () => Promise<{ photos: Photo[]; albums: Album[] }>;
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
  /** Deletes an album. Its photos stay; take the album out of them with `update`. */
  removeAlbum: (albumId: string) => Promise<void>;
  /**
   * Gets an album of your own ready to share with people: gives it a key of its own if it
   * has none, and lists its photos (sealed under that key) for them. Returns the album key,
   * which is what the people it's shared with get, never the space's records key. Photos put
   * in or taken out of a shared album later are listed or unlisted as they change.
   */
  shareAlbum: (albumId: string) => Promise<Uint8Array>;
  /** Stops sharing an album with everyone, and lets its key go. */
  stopSharingAlbum: (albumId: string) => Promise<void>;
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
  /** Revokes every object URL this store made. */
  dispose: () => void;
}

const THUMB_TYPE = 'image/jpeg';
const TOO_LARGE = `That photo is too large. Arcafold takes photos up to ${String(
  Math.floor(STORAGE_SIZES.maxFull / (1024 * 1024)) - 1,
)} MB.`;

/** Who added a photo to someone else's library: their member id and name. */
interface AddedBy {
  id: string;
  name: string;
}

interface PhotoMeta {
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
}

/** How this device reaches a library someone shared with it. */
export interface Membership {
  /** This account's member id in that library. */
  memberId: string;
  /** This account's name, recorded on photos it adds there. */
  myName: string;
  /** The name of whoever shared the library. */
  ownerName: string;
}

interface AlbumMeta {
  v: 1;
  title: string;
  /** The album's own key, base64url, once it has been shared. */
  shareKey?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseAddedBy(value: unknown): AddedBy | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null;
  }
  return { id: value.id, name: value.name };
}

function parsePhotoMeta(value: unknown): PhotoMeta | null {
  if (!isRecord(value)) return null;
  const { v, key, type, width, height, takenAt, favorite, albumIds } = value;
  const by = parseAddedBy(value.by);
  const ok =
    by !== null &&
    v === 1 &&
    typeof key === 'string' &&
    typeof type === 'string' &&
    isPhotoType(type) &&
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
  return meta;
}

function parseAlbumMeta(value: unknown): AlbumMeta | null {
  if (!isRecord(value) || value.v !== 1 || typeof value.title !== 'string') return null;
  const meta: AlbumMeta = { v: 1, title: value.title };
  if (typeof value.shareKey === 'string') meta.shareKey = value.shareKey;
  else if (value.shareKey !== undefined) return null;
  return meta;
}

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

const ALBUM_GONE = 'That album isn’t here anymore.';

function decode(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
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
  return {
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
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    urls.set(name, url);
    return url;
  };

  const forget = (photoId: string) => {
    known.delete(photoId);
    for (const part of ['thumb', 'full', 'view'] as const) {
      const url = urls.get(`${photoId}/${part}`);
      if (url) URL.revokeObjectURL(url);
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
    return crypto.sealRecord(await access(), 'photo', id, encode(meta));
  };

  const sealAlbum = async (id: string, meta: AlbumMeta) => {
    const crypto = await loadCrypto();
    return crypto.sealRecord(await access(), 'album', id, encode(meta));
  };

  /** What a shared album's records are sealed under, or null if it isn't shared. */
  const sharedAccess = async (albumId: string): Promise<SpaceAccess | null> => {
    const key = albumMetas.get(albumId)?.shareKey;
    if (!key) return null;
    const crypto = await loadCrypto();
    return crypto.albumAccess(
      (await access()).token,
      crypto.fromBase64Url(key) ?? new Uint8Array(),
    );
  };

  /**
   * Lists a photo in a shared album: its details sealed under the album key, without its
   * favorite or the rest of its albums, which stay yours.
   */
  const listInAlbum = async (shared: SpaceAccess, albumId: string, photoId: string) => {
    const entry = lookup(photoId);
    const crypto = await loadCrypto();
    const meta: PhotoMeta = { ...entry.meta, favorite: false, albumIds: [albumId] };
    const api = await remote();
    await api.putAlbumItem(
      albumId,
      photoId,
      await crypto.sealRecord(shared, 'photo', photoId, encode(meta)),
    );
  };

  /**
   * Brings the shared albums a photo went into or left up to date. Best effort: the photo's
   * own change is already saved, and sharing an album again lists anything missed.
   */
  const syncShared = async (photoId: string, before: readonly string[], after: string[]) => {
    const api = await remote();
    const changes = [
      ...after.filter((id) => !before.includes(id)).map((id) => ({ id, listed: true })),
      ...before.filter((id) => !after.includes(id)).map((id) => ({ id, listed: false })),
    ];
    await Promise.all(
      changes.map(async ({ id, listed }) => {
        const shared = await sharedAccess(id);
        if (!shared) return;
        if (listed) await listInAlbum(shared, id, photoId);
        else await api.deleteAlbumItem(id, photoId);
      }),
    ).catch(() => undefined);
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
      const plain =
        sealed && entry ? await crypto.decryptFile(entry.key, sealed).catch(() => null) : null;
      deliver(photoId, plain && new Uint8Array(plain));
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

  /** Opens every page of photos `listPage` returns, and remembers their keys. */
  const openPhotos = async (listPage: (after?: string) => Promise<PhotoPage>) => {
    const crypto = await loadCrypto();
    const keys = await access();
    const photos: Photo[] = [];
    let after: string | undefined;
    do {
      const page = await listPage(after);
      for (const stored of page.photos) {
        // A record that doesn't open was tampered with or isn't ours: leave it out.
        const opened = await crypto
          .openRecord(keys, 'photo', stored.id, stored.meta)
          .catch(() => null);
        const meta = opened && parsePhotoMeta(decode(opened));
        const key = meta && crypto.fromBase64Url(meta.key);
        if (!meta || key?.length !== 32) continue;
        known.set(stored.id, { key, meta });
        photos.push(toPhoto(stored.id, meta, membership, stored.thumbSize + stored.fullSize));
      }
      after = page.next ?? undefined;
    } while (after);
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

  return {
    list: async () => {
      const api = await remote();
      const crypto = await loadCrypto();
      const keys = await access();
      // Albums are asked for alongside the photos, not after them.
      const storedAlbums = api.listAlbums();
      storedAlbums.catch(() => undefined);
      const photos = await openPhotos((after) => api.listPhotos(after));
      const albums: Album[] = [];
      for (const stored of (await storedAlbums).albums) {
        const opened = await crypto
          .openRecord(keys, 'album', stored.id, stored.meta)
          .catch(() => null);
        const meta = opened && parseAlbumMeta(decode(opened));
        if (!meta) continue;
        albumMetas.set(stored.id, meta);
        albums.push({ id: stored.id, title: meta.title });
      }
      return { photos, albums };
    },

    image: async (photoId, part) => {
      const cached = urls.get(`${photoId}/${part}`);
      if (cached) return cached;
      const { plain, entry } = await decrypt(photoId, part);
      if (part === 'full') {
        // Originals can be large, so only the latest one stays decrypted in memory.
        for (const [name, url] of urls) {
          if (name.endsWith('/full') || name.endsWith('/view')) {
            URL.revokeObjectURL(url);
            urls.delete(name);
          }
        }
        const copy = await viewableCopy(plain, entry.meta.type);
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
      if (!isPhotoType(photo.type)) throw new FormError('Arcafold can’t store this kind of file.');
      if (crypto.encryptedFileSize(photo.full.length) > STORAGE_SIZES.maxFull) {
        throw new FormError(TOO_LARGE);
      }
      onStage?.('encrypting');
      const id = await crypto.newRecordId();
      const key = await crypto.newFileKey();
      const thumb = new Uint8Array(await crypto.encryptFile(key, photo.thumb));
      const full = new Uint8Array(await crypto.encryptLargeFile(key, photo.full));
      if (thumb.length > STORAGE_SIZES.maxThumb) throw new FormError(TOO_LARGE);
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
      if (membership) meta.by = { id: membership.memberId, name: membership.myName };
      const api = await remote();
      onStage?.('uploading');
      await api.createPhoto({
        id,
        meta: await sealPhoto(id, meta),
        thumbSize: thumb.length,
        fullSize: full.length,
      });
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
      await syncShared(id, [], albumIds);
      return toPhoto(
        id,
        meta,
        membership,
        thumb.length + full.length,
        track(id, 'thumb', photo.thumb, THUMB_TYPE),
      );
    },

    update: async (photo) => {
      const entry = lookup(photo.id);
      const meta: PhotoMeta = { ...entry.meta, favorite: photo.favorite, albumIds: photo.albumIds };
      const api = await remote();
      await api.updatePhoto(photo.id, await sealPhoto(photo.id, meta));
      known.set(photo.id, { ...entry, meta });
      await syncShared(photo.id, entry.meta.albumIds, meta.albumIds);
    },

    remove: async (photoId) => {
      const api = await remote();
      await api.deletePhoto(photoId);
      forget(photoId);
    },

    listTrash: async () => {
      const api = await remote();
      return openPhotos((after) => api.listTrash(after));
    },

    trash: async (photoIds, deletedAt) => {
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
          await crypto.sealRecord(shared, 'album', albumId, encode({ v: 1, title })),
        );
      }
    },

    removeAlbum: async (albumId) => {
      const api = await remote();
      await api.deleteAlbum(albumId);
      albumMetas.delete(albumId);
    },

    shareAlbum: async (albumId) => {
      const crypto = await loadCrypto();
      const api = await remote();
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
        await crypto.sealRecord(shared, 'album', albumId, encode({ v: 1, title: meta.title })),
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
      const api = await remote();
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
      return { thumb, full, type, width, height, takenAt };
    },

    original: async (photoId) => {
      const { plain: full, entry } = await decrypt(photoId, 'full');
      return { full, type: entry.meta.type, takenAt: entry.meta.takenAt };
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

    dispose: () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}

/** A library or album someone shared with this space, and the store that reaches it. */
export interface SharedSource {
  id: string;
  /** Whose library it is. */
  name: string;
  /** Set when only one album was shared, which can be viewed but not changed. */
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
  const changeable = (store: SpaceStore) => {
    if (readOnly.has(store)) throw new FormError(VIEW_ONLY_LIBRARY);
    return store;
  };
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
              return { source, loaded, viewOnly: source.album === true || !(await editable) };
            }),
          ),
        );
      const mine = await own.list();
      const loadedShared = await sharedLists;
      shared = loadedShared.map(({ source }) => source);
      readOnly.clear();
      for (const { source, viewOnly } of loadedShared) if (viewOnly) readOnly.add(source.store);
      const photos = [...mine.photos];
      const albums = [...mine.albums];
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
          photos.push({ ...photo, ...marks });
        }
        for (const album of loaded.albums) {
          if (albumStores.has(album.id)) continue;
          albumStores.set(album.id, source.store);
          albums.push({ ...album, ...albumMarks });
        }
      }
      return { photos, albums };
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
      return source ? { ...added, library: source.name } : added;
    },
    update: async (photo) => changeable(storeOf(photo.id)).update(photo),
    remove: async (photoId) => {
      await changeable(storeOf(photoId)).remove(photoId);
      photoStores.delete(photoId);
    },
    listTrash: async () => {
      // Libraries you can only view keep their Recently deleted to themselves.
      const sources = shared.filter((source) => !readOnly.has(source.store));
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
      eachStore(photoIds, (store, ids) => changeable(store).trash(ids, deletedAt)),
    restore: (photoIds) => eachStore(photoIds, (store, ids) => changeable(store).restore(ids)),
    createAlbum: (title) => own.createAlbum(title),
    renameAlbum: async (albumId, title) =>
      changeable(albumStoreOf(albumId)).renameAlbum(albumId, title),
    removeAlbum: async (albumId) => {
      await changeable(albumStoreOf(albumId)).removeAlbum(albumId);
      albumStores.delete(albumId);
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
    dispose: () => {
      own.dispose();
      for (const source of shared) source.store.dispose();
    },
  };
}

/**
 * A store that keeps nothing: for rendering tests and previews that start from fixed state.
 * Images are whatever `src` the photos already have.
 */
export function memoryStore(initial: { photos: Photo[]; albums: Album[] }): SpaceStore {
  let next = 0;
  const newId = () => {
    next += 1;
    return `local-${String(next)}`;
  };
  return {
    list: () => Promise.resolve(initial),
    image: (photoId) =>
      Promise.resolve(initial.photos.find((photo) => photo.id === photoId)?.src ?? ''),
    viewImage: () => undefined,
    thumbs: (photoIds) =>
      Promise.resolve(
        new Map(
          initial.photos
            .filter((photo) => photo.src && photoIds.includes(photo.id))
            .map((photo) => [photo.id, photo.src]),
        ),
      ),
    previews: (photoIds, onPreview) => {
      // Fixed photos have no encrypted previews to look at.
      for (const photoId of photoIds) onPreview(photoId, null);
      return Promise.resolve();
    },
    add: (photo, albumIds) => {
      const url = URL.createObjectURL(new Blob([photo.full], { type: photo.type }));
      return Promise.resolve({
        id: newId(),
        src: url,
        width: photo.width,
        height: photo.height,
        takenAt: photo.takenAt,
        addedBy: 'me',
        favorite: photo.favorite ?? false,
        albumIds,
      });
    },
    update: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    listTrash: () => Promise.resolve([]),
    trash: (photoIds) => Promise.resolve([...photoIds]),
    restore: (photoIds) => Promise.resolve([...photoIds]),
    createAlbum: (title) => Promise.resolve({ id: newId(), title }),
    renameAlbum: () => Promise.resolve(),
    removeAlbum: () => Promise.resolve(),
    shareAlbum: () => Promise.reject(new FormError('This preview can’t share albums.')),
    stopSharingAlbum: () => Promise.resolve(),
    read: () => Promise.reject(new FormError('This preview can’t move photos.')),
    original: () => Promise.reject(new FormError('This preview can’t download photos.')),
    fingerprint: () => Promise.reject(new FormError('This preview can’t import photos.')),
    fingerprints: () => new Map(),
    dispose: () => undefined,
  };
}
