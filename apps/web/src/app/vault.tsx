import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import type { SpaceKeys } from '@arcafold/crypto';
import type { PhotoPart } from '@arcafold/types';

import { copyNames } from '../lib/copy-names';
import type { Category } from '../lib/file-sort/categories';
import { downloadAll } from '../lib/download-progress';
import type { DownloadProgress } from '../lib/download-progress';
import type { PhotoCopy } from '../lib/save-copies';
import { settleEach } from '../lib/settle-each';
import type { Settled } from '../lib/settle-each';
import { FormError } from './account-ops';
import type { Space } from './account-ops';
import type { NewPhoto, Original, SpaceStore, UploadStage } from './space-store';
import { createThumbLoader } from './thumb-loader';
import {
  initialAlbums,
  initialPhotos,
  initialPrivateAlbums,
  initialPrivatePhotos,
} from '../mock/data';
import type { Album, Photo } from '../mock/data';

/**
 * The open space's photos and albums, decrypted in memory. Changes go to the space's store
 * (ciphertext on the server) first, then into this state.
 */

export interface VaultState {
  photos: Photo[];
  albums: Album[];
  /**
   * Files that aren't photos (PDFs, documents and the rest), newest first. They never show in
   * the timeline, albums, search or People. Left out where a space has none.
   */
  files?: Photo[];
  /** Photos and files in Recently deleted, newest deletion first, once they have loaded. */
  trash?: Photo[];
}

/** Whether an item is a file rather than a photo. */
export function isFile(item: Pick<Photo, 'file'>): boolean {
  return item.file !== undefined;
}

/** A state with `items` sorted into photos and files, in the order they came. */
function sortedIn(state: VaultState, items: readonly Photo[], where: 'start' | 'end'): VaultState {
  const photos = items.filter((item) => !isFile(item));
  const files = items.filter(isFile);
  const place = (list: Photo[], added: Photo[]) =>
    where === 'start' ? [...added, ...list] : [...list, ...added];
  const next: VaultState = { ...state, photos: place(state.photos, photos) };
  if (files.length > 0 || state.files) next.files = place(state.files ?? [], files);
  return next;
}

/** Every photo and file of the open space, wherever it shows. */
export function allItems(state: VaultState): Photo[] {
  return [...state.photos, ...(state.files ?? [])];
}

/** How long a photo stays in Recently deleted before it is deleted for good. */
export const TRASH_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What a delete confirmation says about getting photos back. */
export function trashNote(count: number): string {
  return `You can restore ${count === 1 ? 'it' : 'them'} from Recently deleted for ${String(TRASH_DAYS)} days.`;
}

/** Whole days until a photo deleted at `deletedAt` is deleted for good; 0 once it is due. */
export function trashDaysLeft(deletedAt: string, now = Date.now()): number {
  const left = Date.parse(deletedAt) + TRASH_DAYS * DAY_MS - now;
  return Math.max(0, Math.ceil(left / DAY_MS));
}

/** Whether a deleted photo's 30 days are up. */
export function trashExpired(photo: Pick<Photo, 'deletedAt'>, now = Date.now()): boolean {
  return photo.deletedAt !== undefined && trashDaysLeft(photo.deletedAt, now) === 0;
}

/** A photo back from Recently deleted. */
function withoutDeletedAt(photo: Photo): Photo {
  const rest = { ...photo };
  delete rest.deletedAt;
  return rest;
}

/** Albums whose chosen cover is one of `gone` lose it, and show their newest photo instead. */
function withoutCovers(albums: Album[], gone: ReadonlySet<string>): Album[] {
  return albums.map((album) => {
    if (album.coverPhotoId === undefined || !gone.has(album.coverPhotoId)) return album;
    const rest = { ...album };
    delete rest.coverPhotoId;
    return rest;
  });
}

export type VaultAction =
  | { type: 'loaded'; state: VaultState }
  | { type: 'set-image'; photoId: string; part: PhotoPart; url: string; viewUrl?: string }
  | { type: 'set-thumbs'; urls: ReadonlyMap<string, string> }
  | { type: 'toggle-favorite'; photoId: string }
  | { type: 'set-file'; file: Photo }
  | { type: 'delete-photos'; photoIds: readonly string[] }
  | { type: 'trash-photos'; photoIds: readonly string[]; deletedAt: string }
  | { type: 'restore-photos'; photoIds: readonly string[] }
  | { type: 'set-trash'; trash: Photo[] }
  | { type: 'add-photos'; photos: Photo[] }
  | { type: 'set-details'; photoIds: readonly string[]; change: PhotoDetails }
  | { type: 'create-album'; album: Album }
  | { type: 'rename-album'; albumId: string; title: string }
  | { type: 'delete-album'; albumId: string }
  | { type: 'set-shared-with'; albumId: string; names: string[] };

/** What a change to many photos sets on each: a favorite, or being in an album or not. */
export type PhotoDetails = { favorite: boolean } | { albumId: string; included: boolean };

/** A change to many photos, as asked for: the album comes whole, to check its library. */
export type DetailsChange = { favorite: boolean } | { album: Album; included: boolean };

/** A photo with `change` applied, or the same photo when it changes nothing. */
export function withDetails(photo: Photo, change: PhotoDetails): Photo {
  if ('favorite' in change) {
    return photo.favorite === change.favorite ? photo : { ...photo, favorite: change.favorite };
  }
  const has = photo.albumIds.includes(change.albumId);
  if (has === change.included) return photo;
  const albumIds = change.included
    ? [...photo.albumIds, change.albumId]
    : photo.albumIds.filter((id) => id !== change.albumId);
  return { ...photo, albumIds };
}

export function vaultReducer(state: VaultState, action: VaultAction): VaultState {
  switch (action.type) {
    case 'loaded': {
      // Stores hand back photos and files together; files go to their own list.
      const { photos, ...rest } = action.state;
      return sortedIn({ ...rest, photos: [] }, photos, 'end');
    }
    case 'set-image': {
      const update = (photo: Photo): Photo => {
        if (action.part === 'thumb') {
          return photo.id === action.photoId ? { ...photo, src: action.url } : photo;
        }
        if (photo.id === action.photoId) {
          const rest = { ...photo, fullSrc: action.url };
          if (action.viewUrl === undefined) delete rest.viewSrc;
          else rest.viewSrc = action.viewUrl;
          return rest;
        }
        // The store keeps one original at a time and has revoked the others.
        if (photo.fullSrc === undefined && photo.viewSrc === undefined) return photo;
        const rest = { ...photo };
        delete rest.fullSrc;
        delete rest.viewSrc;
        return rest;
      };
      return {
        ...state,
        photos: state.photos.map(update),
        ...(state.trash && { trash: state.trash.map(update) }),
      };
    }
    case 'set-thumbs': {
      const update = (photo: Photo): Photo => {
        const url = action.urls.get(photo.id);
        return url === undefined ? photo : { ...photo, src: url };
      };
      return {
        ...state,
        photos: state.photos.map(update),
        ...(state.files && { files: state.files.map(update) }),
        ...(state.trash && { trash: state.trash.map(update) }),
      };
    }
    case 'toggle-favorite':
      return {
        ...state,
        photos: state.photos.map((photo) =>
          photo.id === action.photoId ? { ...photo, favorite: !photo.favorite } : photo,
        ),
      };
    case 'set-file':
      return state.files
        ? {
            ...state,
            files: state.files.map((item) => (item.id === action.file.id ? action.file : item)),
          }
        : state;
    case 'delete-photos': {
      const gone = new Set(action.photoIds);
      return {
        ...state,
        photos: state.photos.filter((photo) => !gone.has(photo.id)),
        ...(state.files && { files: state.files.filter((file) => !gone.has(file.id)) }),
        albums: withoutCovers(state.albums, gone),
        ...(state.trash && { trash: state.trash.filter((photo) => !gone.has(photo.id)) }),
      };
    }
    case 'trash-photos': {
      const gone = new Set(action.photoIds);
      const moved = allItems(state)
        .filter((photo) => gone.has(photo.id))
        .map((photo) => ({ ...photo, deletedAt: action.deletedAt }));
      return {
        ...state,
        photos: state.photos.filter((photo) => !gone.has(photo.id)),
        ...(state.files && { files: state.files.filter((file) => !gone.has(file.id)) }),
        albums: withoutCovers(state.albums, gone),
        trash: [...moved, ...(state.trash ?? [])],
      };
    }
    case 'restore-photos': {
      const back = new Set(action.photoIds);
      const trash = state.trash ?? [];
      const restored = trash.filter((photo) => back.has(photo.id)).map(withoutDeletedAt);
      return {
        ...sortedIn(state, restored, 'start'),
        trash: trash.filter((photo) => !back.has(photo.id)),
      };
    }
    case 'set-trash':
      return { ...state, trash: action.trash };
    case 'set-details': {
      const ids = new Set(action.photoIds);
      return {
        ...state,
        photos: state.photos.map((photo) =>
          ids.has(photo.id) ? withDetails(photo, action.change) : photo,
        ),
      };
    }
    case 'add-photos':
      return sortedIn(state, action.photos, 'start');
    case 'create-album':
      return { ...state, albums: [action.album, ...state.albums] };
    case 'rename-album':
      return {
        ...state,
        albums: state.albums.map((album) =>
          album.id === action.albumId ? { ...album, title: action.title } : album,
        ),
      };
    case 'set-shared-with':
      return {
        ...state,
        albums: state.albums.map((album) => {
          if (album.id !== action.albumId) return album;
          if (action.names.length > 0) return { ...album, sharedWith: action.names };
          const rest = { ...album };
          delete rest.sharedWith;
          return rest;
        }),
      };
    case 'delete-album':
      return {
        ...state,
        photos: state.photos.map((photo) =>
          withDetails(photo, { albumId: action.albumId, included: false }),
        ),
        albums: state.albums.filter((album) => album.id !== action.albumId),
      };
  }
}

/**
 * The photos of your timeline: everything except photos that are here only because someone
 * shared an album with you, which stay in that album.
 */
export function timelinePhotos(state: VaultState): Photo[] {
  return state.photos.filter((photo) => !photo.sharedAlbum);
}

/** Photos in an album, newest first. */
export function albumPhotos(state: VaultState, albumId: string): Photo[] {
  return state.photos
    .filter((photo) => photo.albumIds.includes(albumId))
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/**
 * Whether a photo can go in an album: both must be in the same library, and neither can be
 * something you can only view (from an album shared with you, or a view-only library).
 */
export function fitsAlbum(photo: Photo, album: Album): boolean {
  return !isViewOnly(photo) && !isViewOnly(album) && photo.library === album.library;
}

/** Whether a photo or album is someone else's that you can only view and download. */
export function isViewOnly(item: Pick<Photo, 'sharedAlbum' | 'viewOnly'>): boolean {
  return item.sharedAlbum === true || item.viewOnly === true;
}

/** The album's chosen cover, or else its newest photo. */
export function albumCover(state: VaultState, album: Album): Photo | undefined {
  const chosen = album.coverPhotoId
    ? state.photos.find((photo) => photo.id === album.coverPhotoId)
    : undefined;
  return chosen ?? albumPhotos(state, album.id)[0];
}

/** The main library, or the private space that only the private password opens. */
export type { Space } from './account-ops';

/** Fixed contents for both spaces, for rendering tests and previews. */
export interface VaultsState {
  spaces: Record<Space, VaultState>;
}

export const emptyVaults: VaultsState = {
  spaces: { main: { photos: [], albums: [] }, private: { photos: [], albums: [] } },
};

/** The mock library from the design work, for tests and previews. */
export const mockVaults: VaultsState = {
  spaces: {
    main: { photos: initialPhotos, albums: initialAlbums },
    private: { photos: initialPrivatePhotos, albums: initialPrivateAlbums },
  },
};

const VIEW_ONLY = 'Photos in an album shared with you can be viewed, not changed.';
const VIEW_ONLY_PHOTO = 'This photo was shared with you to view. You can’t change it.';

/** How many photos a change to many saves at once. */
const SAVES_AT_ONCE = 4;
/** Moving decrypts and re-encrypts whole originals, so fewer run at once. */
const MOVES_AT_ONCE = 2;

export type VaultStatus = 'loading' | 'ready' | 'failed';

const GONE = 'That photo isn’t in your vault anymore.';

/**
 * Moves photos with one batched call, after `check` lets each through. Photos `check`
 * refuses, or that the call didn't move, are failed.
 */
async function moveAll(
  photoIds: readonly string[],
  move: (photoIds: string[]) => Promise<string[]>,
  check?: (photoId: string) => unknown,
): Promise<Settled<string>> {
  let error: unknown;
  const allowed = photoIds.filter((photoId) => {
    try {
      check?.(photoId);
      return true;
    } catch (caught) {
      error ??= caught;
      return false;
    }
  });
  let moved = new Set<string>();
  if (allowed.length > 0) {
    try {
      moved = new Set(await move(allowed));
    } catch (caught) {
      error ??= caught;
    }
  }
  const settled: Settled<string> = {
    done: photoIds.filter((photoId) => moved.has(photoId)),
    failed: photoIds.filter((photoId) => !moved.has(photoId)),
  };
  if (settled.failed.length > 0) settled.error = error ?? new FormError(GONE);
  return settled;
}

/**
 * Loads Recently deleted after the library, and deletes for good whatever has been there 30
 * days. That only happens on a device that opens the space, since the server never learns
 * when a photo was deleted. Best effort: what fails stays for next time.
 */
export async function loadTrash(
  store: Pick<SpaceStore, 'listTrash' | 'remove'>,
  stopped: () => boolean,
  done: (trash: Photo[]) => void,
  now = Date.now(),
): Promise<void> {
  const trash = await store.listTrash().catch(() => null);
  if (!trash || stopped()) return;
  const expired = trash.filter((photo) => trashExpired(photo, now));
  const purged = await settleEach(expired, SAVES_AT_ONCE, (photo) => store.remove(photo.id));
  if (stopped()) return;
  const gone = new Set(purged.done.map((photo) => photo.id));
  done(
    trash
      .filter((photo) => !gone.has(photo.id))
      .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')),
  );
}

interface VaultValue {
  /** Photos and albums of the open space. */
  state: VaultState;
  status: VaultStatus;
  space: Space;
  /**
   * Encrypts and stores a photo. It isn't shown until `showUploaded`, so a batch of uploads
   * changes the library once instead of after every photo.
   */
  upload: (
    photo: NewPhoto,
    albumId: string | undefined,
    onStage?: (stage: UploadStage) => void,
  ) => Promise<Photo>;
  /** Shows photos that `upload` stored, all in one change. */
  showUploaded: (photos: Photo[]) => void;
  /** Like `upload`, into any number of the space's own albums: for imports. */
  importPhoto: (photo: NewPhoto, albumIds: string[]) => Promise<Photo>;
  /** A photo's fingerprint in this space (see SpaceStore.fingerprint). */
  fingerprint: SpaceStore['fingerprint'];
  /** Fingerprints of the photos this space has, with their ids. */
  knownFingerprints: SpaceStore['fingerprints'];
  toggleFavorite: (photoId: string) => Promise<void>;
  /** Puts a file in a category you chose, which teaches the sorting (lib/file-sort). */
  sortFile: (fileId: string, category: Category) => Promise<void>;
  /** Moves a photo to Recently deleted. */
  deletePhoto: (photoId: string) => Promise<void>;
  /** Moves photos to Recently deleted: each goes through or fails on its own. */
  deletePhotos: (photoIds: readonly string[]) => Promise<Settled<string>>;
  /** Brings photos back from Recently deleted. */
  restorePhotos: (photoIds: readonly string[]) => Promise<Settled<string>>;
  /** Deletes photos in Recently deleted for good, with their files. */
  deleteForever: (photoIds: readonly string[]) => Promise<Settled<string>>;
  /**
   * Sets a favorite, or puts photos in an album or takes them out, saving only the photos it
   * changes. A photo can only go in an album of its own library.
   */
  setDetails: (photoIds: readonly string[], change: DetailsChange) => Promise<Settled<string>>;
  createAlbum: (title: string) => Promise<Album>;
  renameAlbum: (albumId: string, title: string) => Promise<void>;
  /** Deletes an album and takes it out of its photos, which stay in the library. */
  deleteAlbum: (albumId: string) => Promise<void>;
  /**
   * Gets one of your albums ready to share with people and returns its key, for the invite
   * to hand over.
   */
  shareAlbum: (albumId: string) => Promise<Uint8Array>;
  /** Stops sharing an album with everyone. */
  stopSharingAlbum: (albumId: string) => Promise<void>;
  /** Records who an album is shared with now, by name, after someone is added or removed. */
  setSharedWith: (albumId: string, names: string[]) => void;
  /**
   * Downloads and decrypts photos' originals, a few at a time, for saving copies to the
   * device. Each is named by when it was taken. Reports progress after each photo; stops
   * when `signal` aborts.
   */
  originals: (
    photoIds: readonly string[],
    options?: { onProgress?: (progress: DownloadProgress) => void; signal?: AbortSignal },
  ) => Promise<PhotoCopy[]>;
  /**
   * Moves a photo to the other space. Needs that space's keys: `Session.otherSpace`, or the
   * keys just opened for this move.
   */
  movePhoto: (photoId: string, otherKeys?: SpaceKeys) => Promise<void>;
  movePhotos: (photoIds: readonly string[], otherKeys?: SpaceKeys) => Promise<Settled<string>>;
  /**
   * Downloads and decrypts a file's original into memory, to show it in the app. Nothing is
   * kept: the bytes are the caller's, dropped when it lets them go.
   */
  openFile: (fileId: string) => Promise<Original>;
  /** Starts decrypting a photo's original; `fullSrc` is set when it's ready. */
  loadFull: (photoId: string) => void;
  /**
   * Asks for photos' previews, for when they come near the screen. Asking twice is free.
   * Photos `onScreen` already are downloaded first.
   */
  requestThumbs: (photoIds: readonly string[], onScreen?: boolean) => void;
  /**
   * Downloads and decrypts previews to look at on this device, keeping none of them (see
   * SpaceStore.previews). Never changes, so background work can hold on to it.
   */
  previews: SpaceStore['previews'];
}

const VaultContext = createContext<VaultValue | null>(null);

const noRequests = () => undefined;

/**
 * Just `requestThumbs`, which never changes, apart from the vault (which changes with every
 * preview that arrives), so every image on screen doesn't re-render each time one does.
 */
const RequestThumbsContext = createContext<VaultValue['requestThumbs']>(noRequests);

/**
 * Decrypted photos for the open session, in memory only. Mount it with a key that changes
 * whenever keys are dropped, so locking throws everything away.
 */
export function VaultProvider({
  children,
  space,
  store,
  otherKeys,
  storeFor,
  initialState,
}: {
  children: ReactNode;
  space: Space;
  store: SpaceStore;
  /** The other space's keys, once they are in memory. Only used to move photos there. */
  otherKeys: SpaceKeys | undefined;
  /** Makes the store for another space's keys. */
  storeFor: (keys: SpaceKeys) => SpaceStore;
  /** Fixed contents instead of loading from the store. */
  initialState?: VaultState | undefined;
}) {
  const [state, dispatch] = useReducer(vaultReducer, initialState ?? { photos: [], albums: [] });
  const [status, setStatus] = useState<VaultStatus>(initialState ? 'ready' : 'loading');

  // Stable, so the upload queue can hold on to it across renders.
  const showUploaded = useCallback((photos: Photo[]) => {
    // Newest first, like the rest of the timeline.
    if (photos.length > 0) dispatch({ type: 'add-photos', photos: [...photos].reverse() });
  }, []);

  const previews = useCallback<SpaceStore['previews']>(
    (photoIds, onPreview) => store.previews(photoIds, onPreview),
    [store],
  );

  const thumbLoader = useRef<VaultValue['requestThumbs'] | null>(null);
  const requestThumbs = useCallback((photoIds: readonly string[], onScreen?: boolean) => {
    thumbLoader.current?.(photoIds, onScreen);
  }, []);

  useEffect(() => {
    if (initialState) return;
    let cancelled = false;
    // A function, so checks after an await see the cleanup's change.
    const stopped = () => cancelled;
    const loader = createThumbLoader({
      fetch: (photoIds, onThumb) => store.thumbs(photoIds, onThumb),
      onReady: (urls) => {
        dispatch({ type: 'set-thumbs', urls });
      },
    });
    thumbLoader.current = loader.request;
    store.list().then(
      (loaded) => {
        if (stopped()) return;
        dispatch({ type: 'loaded', state: loaded });
        setStatus('ready');
        void loadTrash(store, stopped, (trash) => {
          dispatch({ type: 'set-trash', trash });
        });
      },
      () => {
        if (!stopped()) setStatus('failed');
      },
    );
    return () => {
      cancelled = true;
      thumbLoader.current = null;
      loader.stop();
      store.dispose();
    };
  }, [store, initialState]);

  const value = useMemo<VaultValue>(() => {
    const find = (photoId: string): Photo => {
      const photo =
        state.photos.find((candidate) => candidate.id === photoId) ??
        state.files?.find((candidate) => candidate.id === photoId);
      if (!photo) throw new FormError('That photo isn’t in your vault anymore.');
      return photo;
    };
    /** A photo that may be changed: not one someone shared with you to view only. */
    const findChangeable = (photoId: string): Photo => {
      const photo = find(photoId);
      if (photo.sharedAlbum) throw new FormError(VIEW_ONLY);
      if (photo.viewOnly) throw new FormError(VIEW_ONLY_PHOTO);
      return photo;
    };
    const otherStoreFor = (keys: SpaceKeys | undefined) => {
      if (!keys) throw new FormError('Unlock the other space first.');
      return storeFor(keys);
    };
    const moveOne = async (otherStore: SpaceStore, photoId: string) => {
      if (findChangeable(photoId).library !== undefined) {
        throw new FormError('Photos in a library shared with you stay in it.');
      }
      // Albums belong to one space, so a moved photo arrives unfiled. It is re-encrypted
      // under a new key and id, so nothing ties the two copies together.
      await otherStore.add(await store.read(photoId), []);
      await store.remove(photoId);
    };
    return {
      state,
      status,
      space,
      // Files stay out of albums for now: they live in Files.
      upload: (photo, albumId, onStage) =>
        store.add(photo, albumId && !photo.file ? [albumId] : [], onStage),
      showUploaded,
      importPhoto: (photo, albumIds) => store.add(photo, albumIds),
      fingerprint: (original) => store.fingerprint(original),
      knownFingerprints: () => store.fingerprints(),
      toggleFavorite: async (photoId) => {
        const photo = findChangeable(photoId);
        dispatch({ type: 'toggle-favorite', photoId });
        try {
          await store.update({ ...photo, favorite: !photo.favorite });
        } catch (error) {
          dispatch({ type: 'toggle-favorite', photoId });
          throw error;
        }
      },
      sortFile: async (fileId, category) => {
        const item = findChangeable(fileId);
        if (!item.file) throw new FormError(GONE);
        const sorted: Photo = {
          ...item,
          file: { ...item.file, category, sortedByYou: true },
        };
        dispatch({ type: 'set-file', file: sorted });
        try {
          await store.update(sorted);
        } catch (error) {
          dispatch({ type: 'set-file', file: item });
          throw error;
        }
      },
      deletePhoto: async (photoId) => {
        findChangeable(photoId);
        const deletedAt = new Date().toISOString();
        const moved = await store.trash([photoId], deletedAt);
        if (!moved.includes(photoId)) throw new FormError(GONE);
        dispatch({ type: 'trash-photos', photoIds: moved, deletedAt });
      },
      deletePhotos: async (photoIds) => {
        const deletedAt = new Date().toISOString();
        const result = await moveAll(
          photoIds,
          (ids) => store.trash(ids, deletedAt),
          findChangeable,
        );
        dispatch({ type: 'trash-photos', photoIds: result.done, deletedAt });
        return result;
      },
      restorePhotos: async (photoIds) => {
        const result = await moveAll(photoIds, (ids) => store.restore(ids));
        dispatch({ type: 'restore-photos', photoIds: result.done });
        return result;
      },
      deleteForever: async (photoIds) => {
        const result = await settleEach(photoIds, SAVES_AT_ONCE, (photoId) =>
          store.remove(photoId),
        );
        dispatch({ type: 'delete-photos', photoIds: result.done });
        return result;
      },
      setDetails: async (photoIds, requested) => {
        // The album comes whole, since one made a moment ago isn't in this render's state.
        const album = 'album' in requested ? requested.album : null;
        const change: PhotoDetails =
          'album' in requested
            ? { albumId: requested.album.id, included: requested.included }
            : requested;
        const result = await settleEach(photoIds, SAVES_AT_ONCE, async (photoId) => {
          const photo = findChangeable(photoId);
          if (album && !fitsAlbum(photo, album)) {
            throw new FormError('Photos can only go in albums of their own library.');
          }
          const changed = withDetails(photo, change);
          if (changed !== photo) await store.update(changed);
        });
        dispatch({ type: 'set-details', photoIds: result.done, change });
        return result;
      },
      createAlbum: async (title) => {
        const album = await store.createAlbum(title);
        dispatch({ type: 'create-album', album });
        return album;
      },
      renameAlbum: async (albumId, title) => {
        await store.renameAlbum(albumId, title);
        dispatch({ type: 'rename-album', albumId, title });
      },
      deleteAlbum: async (albumId) => {
        await store.removeAlbum(albumId);
        // A photo that still names the deleted album shows nothing for it, so taking the
        // album out of the photos' records is best effort.
        const filed = state.photos.filter((photo) => photo.albumIds.includes(albumId));
        await settleEach(filed, SAVES_AT_ONCE, (photo) =>
          store.update(withDetails(photo, { albumId, included: false })),
        );
        dispatch({ type: 'delete-album', albumId });
      },
      shareAlbum: (albumId) => store.shareAlbum(albumId),
      stopSharingAlbum: async (albumId) => {
        await store.stopSharingAlbum(albumId);
        dispatch({ type: 'set-shared-with', albumId, names: [] });
      },
      setSharedWith: (albumId, names) => {
        dispatch({ type: 'set-shared-with', albumId, names });
      },
      originals: async (photoIds, options) => {
        const items = photoIds.map((id) => ({ id, size: find(id).size ?? 0 }));
        const originals = await downloadAll(items, (id) => store.original(id), options);
        const names = copyNames(originals);
        return originals.map(({ full, type, takenAt }, index) => ({
          name: names[index] ?? '',
          type,
          takenAt,
          data: full,
        }));
      },
      movePhoto: async (photoId, keys = otherKeys) => {
        const otherStore = otherStoreFor(keys);
        try {
          await moveOne(otherStore, photoId);
        } finally {
          otherStore.dispose();
        }
        dispatch({ type: 'delete-photos', photoIds: [photoId] });
      },
      movePhotos: async (photoIds, keys = otherKeys) => {
        const otherStore = otherStoreFor(keys);
        const result = await settleEach(photoIds, MOVES_AT_ONCE, (photoId) =>
          moveOne(otherStore, photoId),
        );
        otherStore.dispose();
        dispatch({ type: 'delete-photos', photoIds: result.done });
        return result;
      },
      openFile: async (fileId) => {
        if (!find(fileId).file) throw new FormError('That isn’t a file.');
        return store.original(fileId);
      },
      loadFull: (photoId) => {
        void store.image(photoId, 'full').then(
          (url) => {
            const viewUrl = store.viewImage(photoId);
            dispatch({
              type: 'set-image',
              photoId,
              part: 'full',
              url,
              ...(viewUrl === undefined ? {} : { viewUrl }),
            });
          },
          () => undefined,
        );
      },
      requestThumbs,
      previews,
    };
  }, [state, status, space, store, otherKeys, storeFor, requestThumbs, showUploaded, previews]);

  return (
    <VaultContext value={value}>
      <RequestThumbsContext value={requestThumbs}>{children}</RequestThumbsContext>
    </VaultContext>
  );
}

/** Asks for previews when inside a vault; does nothing outside one (as in static previews). */
export function useRequestThumbs(): VaultValue['requestThumbs'] {
  return useContext(RequestThumbsContext);
}

export function useVault(): VaultValue {
  const vault = useContext(VaultContext);
  if (!vault) throw new Error('useVault must be used inside VaultProvider');
  return vault;
}
