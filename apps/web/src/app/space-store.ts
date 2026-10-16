import type { SpaceAccess, SpaceKeys } from '@twofold/crypto';
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
    type.startsWith('image/') &&
    typeof width === 'number' &&
    typeof height === 'number' &&
    typeof takenAt === 'string' &&
    !Number.isNaN(Date.parse(takenAt)) &&
    typeof favorite === 'boolean' &&
    Array.isArray(albumIds) &&
    albumIds.every((id) => typeof id === 'string');
  if (!ok) return null;
  const meta: PhotoMeta = { v, key, type, width, height, takenAt, favorite, albumIds };
  if (by) meta.by = by;
  return meta;
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

/** Who added a photo, as this device sees it. The owner's photos carry no `by`. */
function addedBy(
  meta: PhotoMeta,
  membership: Membership | null,
): Pick<Photo, 'addedBy' | 'addedByName'> {
  const mine = meta.by ? meta.by.id === membership?.memberId : membership === null;
  if (mine) return { addedBy: 'me' };
  return { addedBy: 'contact', addedByName: meta.by?.name ?? membership?.ownerName ?? '' };
}

function toPhoto(id: string, meta: PhotoMeta, membership: Membership | null, src = ''): Photo {
  return {
    id,
    src,
    width: meta.width,
    height: meta.height,
    takenAt: meta.takenAt,
    ...addedBy(meta, membership),
    favorite: meta.favorite,
    albumIds: meta.albumIds,
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
    return crypto.sealRecord(await access(), 'photo', id, encode(meta));
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
      const keys = await access();
      const photos: Photo[] = [];
      let after: string | undefined;
      do {
        const page = await api.listPhotos(after);
        for (const stored of page.photos) {
          // A record that doesn't open was tampered with or isn't ours: leave it out.
          const opened = await crypto
            .openRecord(keys, 'photo', stored.id, stored.meta)
            .catch(() => null);
          const meta = opened && parsePhotoMeta(decode(opened));
          const key = meta && crypto.fromBase64Url(meta.key);
          if (!meta || key?.length !== 32) continue;
          known.set(stored.id, { key, meta });
          photos.push(toPhoto(stored.id, meta, membership));
        }
        after = page.next ?? undefined;
      } while (after);
      const albums: Album[] = [];
      for (const stored of (await api.listAlbums()).albums) {
        const opened = await crypto
          .openRecord(keys, 'album', stored.id, stored.meta)
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
      if (membership) meta.by = { id: membership.memberId, name: membership.myName };
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
      return toPhoto(id, meta, membership, track(id, 'thumb', photo.thumb, THUMB_TYPE));
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
        meta: await crypto.sealRecord(await access(), 'album', id, encode(meta)),
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

/** A library someone shared with this space, and the store that reaches it. */
export interface SharedSource {
  id: string;
  /** Whose library it is. */
  name: string;
  store: SpaceStore;
}

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
  const photoStores = new Map<string, SpaceStore>();
  const albumStores = new Map<string, SpaceStore>();
  const storeOf = (photoId: string) => photoStores.get(photoId) ?? own;

  return {
    list: async () => {
      const mine = await own.list();
      shared = await loadShared().catch(() => []);
      const photos = [...mine.photos];
      const albums = [...mine.albums];
      for (const source of shared) {
        const loaded = await source.store.list().catch(() => null);
        if (!loaded) continue;
        for (const photo of loaded.photos) {
          photoStores.set(photo.id, source.store);
          photos.push({ ...photo, library: source.name });
        }
        for (const album of loaded.albums) {
          albumStores.set(album.id, source.store);
          albums.push({ ...album, library: source.name });
        }
      }
      return { photos, albums };
    },
    image: (photoId, part) => storeOf(photoId).image(photoId, part),
    add: async (photo, albumIds, onStage) => {
      const albumStore = albumIds[0] === undefined ? undefined : albumStores.get(albumIds[0]);
      const target = albumStore ?? own;
      const added = await target.add(photo, albumIds, onStage);
      if (target === own) return added;
      photoStores.set(added.id, target);
      const source = shared.find((candidate) => candidate.store === target);
      return source ? { ...added, library: source.name } : added;
    },
    update: (photo) => storeOf(photo.id).update(photo),
    remove: async (photoId) => {
      await storeOf(photoId).remove(photoId);
      photoStores.delete(photoId);
    },
    createAlbum: (title) => own.createAlbum(title),
    read: (photoId) => storeOf(photoId).read(photoId),
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
