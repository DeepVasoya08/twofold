import type { SpaceKeys } from '@twofold/crypto';
import { STORAGE_SIZES } from '@twofold/types';
import type { PhotoPart } from '@twofold/types';

import { spaceApi } from '../lib/api';
import type { SpaceApi } from '../lib/api';
import type { Album, Photo } from '../mock/data';
import { FormError } from './account-ops';

/**
 * One space's photos and albums, stored encrypted on the server. Every photo has its own
 * key, kept inside the photo's sealed metadata; the metadata and albums are sealed under the
 * space key. Decrypted images only ever exist as in-memory object URLs, revoked on dispose.
 */

const loadCrypto = () => import('@twofold/crypto');

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
  add: (
    photo: NewPhoto,
    albumIds: string[],
    onStage?: (stage: UploadStage) => void,
  ) => Promise<Photo>;
  /** Saves a photo's favorite and albums. */
  update: (photo: Photo) => Promise<void>;
  remove: (photoId: string) => Promise<void>;
  createAlbum: (title: string) => Promise<Album>;
  /** Downloads and decrypts a photo's files, to add them to another space. */
  read: (photoId: string) => Promise<NewPhoto>;
  /** Revokes every object URL this store made. */
  dispose: () => void;
}

const THUMB_TYPE = 'image/jpeg';
const TOO_LARGE = `That photo is too large. Twofold takes photos up to ${String(
  Math.floor(STORAGE_SIZES.maxFull / (1024 * 1024)) - 1,
)} MB.`;

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
}

interface AlbumMeta {
  v: 1;
  title: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePhotoMeta(value: unknown): PhotoMeta | null {
  if (!isRecord(value)) return null;
  const { v, key, type, width, height, takenAt, favorite, albumIds } = value;
  const ok =
    v === 1 &&
    typeof key === 'string' &&
    typeof type === 'string' &&
    type.startsWith('image/') &&
    typeof width === 'number' &&
    typeof height === 'number' &&
    typeof takenAt === 'string' &&
    !Number.isNaN(Date.parse(takenAt)) &&
    typeof favorite === 'boolean' &&
    Array.isArray(albumIds) &&
    albumIds.every((id) => typeof id === 'string');
  return ok ? { v, key, type, width, height, takenAt, favorite, albumIds } : null;
}

function parseAlbumMeta(value: unknown): AlbumMeta | null {
  if (!isRecord(value)) return null;
  return value.v === 1 && typeof value.title === 'string' ? { v: 1, title: value.title } : null;
}

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function decode(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function toPhoto(id: string, meta: PhotoMeta, src = ''): Photo {
  return {
    id,
    src,
    width: meta.width,
    height: meta.height,
    takenAt: meta.takenAt,
    addedBy: 'me',
    favorite: meta.favorite,
    albumIds: meta.albumIds,
  };
}

/** What the store keeps per photo: its file key and type, which the UI never needs. */
interface Known {
  key: Uint8Array;
  meta: PhotoMeta;
}

export function remoteStore(
  space: SpaceKeys,
  makeApi: (token: string) => SpaceApi = spaceApi,
): SpaceStore {
  let apiPromise: Promise<SpaceApi> | null = null;
  const remote = () =>
    (apiPromise ??= loadCrypto().then((crypto) => makeApi(crypto.spaceToken(space))));
  const known = new Map<string, Known>();
  const urls = new Map<string, string>();

  const track = (
    photoId: string,
    part: PhotoPart,
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
    for (const part of ['thumb', 'full'] as const) {
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
    return crypto.sealRecord(space, 'photo', id, encode(meta));
  };

  const decrypt = async (photoId: string, part: PhotoPart) => {
    const entry = lookup(photoId);
    const api = await remote();
    const crypto = await loadCrypto();
    const sealed = await api.getFile(photoId, part);
    const plain = await crypto.decryptFile(entry.key, sealed);
    return { plain: new Uint8Array(plain), entry };
  };

  return {
    list: async () => {
      const api = await remote();
      const crypto = await loadCrypto();
      const photos: Photo[] = [];
      let after: string | undefined;
      do {
        const page = await api.listPhotos(after);
        for (const stored of page.photos) {
          // A record that doesn't open was tampered with or isn't ours: leave it out.
          const opened = await crypto
            .openRecord(space, 'photo', stored.id, stored.meta)
            .catch(() => null);
          const meta = opened && parsePhotoMeta(decode(opened));
          const key = meta && crypto.fromBase64Url(meta.key);
          if (!meta || key?.length !== 32) continue;
          known.set(stored.id, { key, meta });
          photos.push(toPhoto(stored.id, meta));
        }
        after = page.next ?? undefined;
      } while (after);
      const albums: Album[] = [];
      for (const stored of (await api.listAlbums()).albums) {
        const opened = await crypto
          .openRecord(space, 'album', stored.id, stored.meta)
          .catch(() => null);
        const meta = opened && parseAlbumMeta(decode(opened));
        if (meta) albums.push({ id: stored.id, title: meta.title });
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
          if (name.endsWith('/full')) {
            URL.revokeObjectURL(url);
            urls.delete(name);
          }
        }
      }
      return track(photoId, part, plain, part === 'thumb' ? THUMB_TYPE : entry.meta.type);
    },

    add: async (photo, albumIds, onStage) => {
      const crypto = await loadCrypto();
      if (crypto.encryptedFileSize(photo.full.length) > STORAGE_SIZES.maxFull) {
        throw new FormError(TOO_LARGE);
      }
      onStage?.('encrypting');
      const id = await crypto.newRecordId();
      const key = await crypto.newFileKey();
      const thumb = new Uint8Array(await crypto.encryptFile(key, photo.thumb));
      const full = new Uint8Array(await crypto.encryptFile(key, photo.full));
      if (thumb.length > STORAGE_SIZES.maxThumb) throw new FormError(TOO_LARGE);
      const meta: PhotoMeta = {
        v: 1,
        key: crypto.toBase64Url(key),
        type: photo.type,
        width: photo.width,
        height: photo.height,
        takenAt: photo.takenAt,
        favorite: false,
        albumIds,
      };
      const api = await remote();
      onStage?.('uploading');
      await api.createPhoto({
        id,
        meta: await sealPhoto(id, meta),
        thumbSize: thumb.length,
        fullSize: full.length,
      });
      await api.putFile(id, 'thumb', thumb);
      await api.putFile(id, 'full', full);
      await api.commitPhoto(id);
      known.set(id, { key, meta });
      return toPhoto(id, meta, track(id, 'thumb', photo.thumb, THUMB_TYPE));
    },

    update: async (photo) => {
      const entry = lookup(photo.id);
      const meta: PhotoMeta = { ...entry.meta, favorite: photo.favorite, albumIds: photo.albumIds };
      const api = await remote();
      await api.updatePhoto(photo.id, await sealPhoto(photo.id, meta));
      known.set(photo.id, { ...entry, meta });
    },

    remove: async (photoId) => {
      const api = await remote();
      await api.deletePhoto(photoId);
      forget(photoId);
    },

    createAlbum: async (title) => {
      const crypto = await loadCrypto();
      const id = await crypto.newRecordId();
      const meta: AlbumMeta = { v: 1, title };
      const api = await remote();
      await api.createAlbum({
        id,
        meta: await crypto.sealRecord(space, 'album', id, encode(meta)),
      });
      return { id, title };
    },

    read: async (photoId) => {
      const { plain: full, entry } = await decrypt(photoId, 'full');
      const { plain: thumb } = await decrypt(photoId, 'thumb');
      const { type, width, height, takenAt } = entry.meta;
      return { thumb, full, type, width, height, takenAt };
    },

    dispose: () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
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
    add: (photo, albumIds) => {
      const url = URL.createObjectURL(new Blob([photo.full], { type: photo.type }));
      return Promise.resolve({
        id: newId(),
        src: url,
        width: photo.width,
        height: photo.height,
        takenAt: photo.takenAt,
        addedBy: 'me',
        favorite: false,
        albumIds,
      });
    },
    update: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    createAlbum: (title) => Promise.resolve({ id: newId(), title }),
    read: () => Promise.reject(new FormError('This preview can’t move photos.')),
    dispose: () => undefined,
  };
}
