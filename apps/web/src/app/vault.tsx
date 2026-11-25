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
import type { Category } from '@arcafold/core/file-categories';
import { downloadAll } from '../lib/download-progress';
import type { DownloadProgress } from '../lib/download-progress';
import type { PhotoCopy } from '../lib/save-copies';
import { settleEach } from '../lib/settle-each';
import type { Settled } from '../lib/settle-each';
import type { Space } from '@arcafold/core/account';
import { createThumbLoader } from '@arcafold/core/library/thumb-loader';
import {
  initialAlbums,
  initialPhotos,
  initialPrivateAlbums,
  initialPrivatePhotos,
} from '../mock/data';
import { FormError } from '@arcafold/core/errors';
import { GONE, loadTrash, moveAll } from '@arcafold/core/library/trash';

export {
  TRASH_DAYS,
  loadTrash,
  trashDaysLeft,
  trashExpired,
  trashNote,
} from '@arcafold/core/library/trash';
import type {
  NewPhoto,
  Original,
  SpaceStore,
  UploadStage,
} from '@arcafold/core/library/space-store';
import type { Album, Folder, Photo } from '@arcafold/core/library/model';
import {
  canMoveFolder,
  expiredFolders,
  folderName,
  folderRestore,
  folderTrash,
  folderTree,
  liveFolders,
  withFolder,
} from '@arcafold/core/library/folders';
import {
  addsByUpload,
  canFillAlbum,
  copiesInto,
  fitsAlbum,
  isViewOnly,
  withAlbum,
} from '@arcafold/core/library/albums';

/**
 * The open space's photos and albums, decrypted in memory. Changes go to the space's store
 * (ciphertext on the server) first, then into this state.
 */

export interface VaultState {
  photos: Photo[];
  albums: Album[];
  /**
   * Files that aren't photos (PDFs, documents and the rest), newest first. They never show in
   * the timeline, search or People; they can go in albums. Left out where a space has none.
   */
  files?: Photo[];
  /** Photos and files in Recently deleted, newest deletion first, once they have loaded. */
  trash?: Photo[];
  /** Folders in Files, including those in Recently deleted. Left out where there are none. */
  folders?: Folder[];
}

/** The open space's folders, including those in Recently deleted. */
export function foldersOf(state: VaultState): Folder[] {
  return state.folders ?? [];
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
  | { type: 'set-shared-with'; albumId: string; names: string[] }
  | { type: 'set-folders'; folders: readonly Folder[] }
  | { type: 'remove-folders'; folderIds: readonly string[] }
  | { type: 'move-to-folder'; itemIds: readonly string[]; folderId: string | null };

/** What a change to many photos sets on each: a favorite, or being in an album or not. */
export type PhotoDetails = { favorite: boolean } | { albumId: string; included: boolean };

/** A change to many photos, as asked for: the album comes whole, to check its library. */
export type DetailsChange = { favorite: boolean } | { album: Album; included: boolean };

/** A photo with `change` applied, or the same photo when it changes nothing. */
export function withDetails(photo: Photo, change: PhotoDetails): Photo {
  if ('favorite' in change) {
    return photo.favorite === change.favorite ? photo : { ...photo, favorite: change.favorite };
  }
  return withAlbum(photo, change.albumId, change.included);
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
      const update = (photo: Photo) =>
        ids.has(photo.id) ? withDetails(photo, action.change) : photo;
      return {
        ...state,
        photos: state.photos.map(update),
        ...(state.files && { files: state.files.map(update) }),
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
    case 'set-folders': {
      const changed = new Map(action.folders.map((folder) => [folder.id, folder]));
      const kept = foldersOf(state).map((folder) => changed.get(folder.id) ?? folder);
      const known = new Set(kept.map((folder) => folder.id));
      const added = action.folders.filter((folder) => !known.has(folder.id));
      return { ...state, folders: [...kept, ...added] };
    }
    case 'remove-folders': {
      const gone = new Set(action.folderIds);
      return { ...state, folders: foldersOf(state).filter((folder) => !gone.has(folder.id)) };
    }
    case 'move-to-folder': {
      const ids = new Set(action.itemIds);
      const folders = foldersOf(state);
      const update = (item: Photo) =>
        ids.has(item.id) ? withFolder(item, action.folderId, folders) : item;
      return {
        ...state,
        photos: state.photos.map(update),
        ...(state.files && { files: state.files.map(update) }),
      };
    }
    case 'delete-album': {
      const update = (photo: Photo) =>
        withDetails(photo, { albumId: action.albumId, included: false });
      return {
        ...state,
        photos: state.photos.map(update),
        ...(state.files && { files: state.files.map(update) }),
        albums: state.albums.filter((album) => album.id !== action.albumId),
      };
    }
  }
}

/**
 * The photos of your timeline: everything except photos that are here only because someone
 * shared an album with you, which stay in that album.
 */
export function timelinePhotos(state: VaultState): Photo[] {
  return state.photos.filter((photo) => !photo.sharedAlbum);
}

/** Files in an album, newest first. */
export function albumFiles(state: VaultState, albumId: string): Photo[] {
  return (state.files ?? [])
    .filter((item) => item.albumIds.includes(albumId))
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/** Photos in an album, newest first. */
export function albumPhotos(state: VaultState, albumId: string): Photo[] {
  return state.photos
    .filter((photo) => photo.albumIds.includes(albumId))
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

export { addsByUpload, canFillAlbum, copiesInto, fitsAlbum, isViewOnly };

/** The album's chosen cover, or else its newest photo. */
export function albumCover(state: VaultState, album: Album): Photo | undefined {
  const chosen = album.coverPhotoId
    ? state.photos.find((photo) => photo.id === album.coverPhotoId)
    : undefined;
  return chosen ?? albumPhotos(state, album.id)[0];
}

/** The main library, or the private space that only the private password opens. */
export type { Space } from '@arcafold/core/account';

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
const FOLDER_GONE = 'That folder isn’t here anymore.';
/** What to show when some of a change to a folder didn't go through. */
function failure(settled: Settled<unknown>): Error {
  return settled.error instanceof Error ? settled.error : new FormError(FOLDER_GONE);
}

const VIEW_ONLY_FOLDER = 'This folder was shared with you to view. You can’t change it.';
const VIEW_ONLY_PHOTO = 'This photo was shared with you to view. You can’t change it.';

/** How many photos a change to many saves at once. */
const SAVES_AT_ONCE = 4;
/** Moving decrypts and re-encrypts whole originals, so fewer run at once. */
const MOVES_AT_ONCE = 2;

export type VaultStatus = 'loading' | 'ready' | 'failed';

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
  /** Makes a folder in Files, inside `parentId` or at the top. */
  createFolder: (name: string, parentId?: string) => Promise<Folder>;
  renameFolder: (folderId: string, name: string) => Promise<void>;
  /** Moves a folder into another (or to the top of Files, for null). */
  moveFolder: (folderId: string, parentId: string | null) => Promise<void>;
  /**
   * Moves files (or photos) into a folder, or out to the top of Files for null, saving only
   * those it changes. Each goes through or fails on its own.
   */
  moveToFolder: (itemIds: readonly string[], folderId: string | null) => Promise<Settled<string>>;
  /** Moves a folder to Recently deleted, with the folders and files inside it. */
  deleteFolder: (folderId: string) => Promise<void>;
  /** Brings a folder back from Recently deleted, with what was deleted along with it. */
  restoreFolder: (folderId: string) => Promise<void>;
  /** Deletes a folder in Recently deleted for good, with what was deleted along with it. */
  deleteFolderForever: (folderId: string) => Promise<void>;
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
          // Folders whose 30 days are up go too, now their files have (best effort).
          const expired = expiredFolders(loaded.folders).filter(
            (folder) => folder.library === undefined,
          );
          void settleEach(expired, SAVES_AT_ONCE, (folder) => store.removeAlbum(folder.id)).then(
            (purged) => {
              if (!stopped() && purged.done.length > 0) {
                dispatch({
                  type: 'remove-folders',
                  folderIds: purged.done.map((folder) => folder.id),
                });
              }
            },
          );
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
    const folders = foldersOf(state);
    /** A folder that may be changed: not one in a library you can only view. */
    const findFolder = (folderId: string): Folder => {
      const folder = folders.find((candidate) => candidate.id === folderId);
      if (!folder) throw new FormError(FOLDER_GONE);
      if (folder.viewOnly) throw new FormError(VIEW_ONLY_FOLDER);
      return folder;
    };
    /** Saves folders, then shows them as saved, a few at a time. */
    const saveFolders = async (changed: Folder[]) => {
      const result = await settleEach(changed, SAVES_AT_ONCE, (folder) => store.saveFolder(folder));
      dispatch({ type: 'set-folders', folders: result.done });
      if (result.failed.length > 0) throw failure(result);
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
      // Files go into a folder they're uploaded to, but stay out of albums: they live in Files.
      upload: (photo, albumId, onStage) => {
        const intoFolder = albumId !== undefined && liveFolders(folders).has(albumId);
        const albumIds = albumId && (intoFolder || !photo.file) ? [albumId] : [];
        return store.add(photo, albumIds, onStage);
      },
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
        // Into an album shared with you that you may add to, your photos go as copies.
        if (album !== null && 'included' in change && change.included && addsByUpload(album)) {
          const copies: Photo[] = [];
          const copied = await settleEach(photoIds, 1, async (photoId) => {
            const photo = find(photoId);
            if (!copiesInto(photo, album)) {
              throw new FormError('Only your own photos can go in an album shared with you.');
            }
            copies.push(await store.add(await store.read(photoId), [album.id]));
          });
          showUploaded(copies);
          return copied;
        }
        // In an album shared with you that you may add to, photos can be taken out.
        const takingOut =
          album !== null && 'included' in change && !change.included && addsByUpload(album);
        const result = await settleEach(photoIds, SAVES_AT_ONCE, async (photoId) => {
          if (takingOut) {
            const photo = find(photoId);
            if (photo.library !== album.library) throw new FormError(VIEW_ONLY);
            const changed = withDetails(photo, change);
            if (changed !== photo) await store.update(changed);
            return;
          }
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
        // A photo or file that still names the deleted album shows nothing for it, so taking
        // the album out of their records is best effort.
        const filed = allItems(state).filter((photo) => photo.albumIds.includes(albumId));
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
      createFolder: async (name, parentId) => {
        if (parentId !== undefined) findFolder(parentId);
        const folder = await store.createFolder(folderName(name), parentId);
        dispatch({ type: 'set-folders', folders: [folder] });
        return folder;
      },
      renameFolder: async (folderId, name) => {
        await saveFolders([{ ...findFolder(folderId), name: folderName(name) }]);
      },
      moveFolder: async (folderId, parentId) => {
        const folder = findFolder(folderId);
        if (!canMoveFolder(folders, folderId, parentId)) {
          throw new FormError('A folder can’t go inside itself.');
        }
        const moved = { ...folder };
        if (parentId === null) delete moved.parentId;
        else moved.parentId = parentId;
        await saveFolders([moved]);
      },
      moveToFolder: async (itemIds, folderId) => {
        const target = folderId === null ? undefined : findFolder(folderId);
        const result = await settleEach(itemIds, SAVES_AT_ONCE, async (itemId) => {
          const item = findChangeable(itemId);
          if (target && item.library !== target.library) {
            throw new FormError('Files can only go in folders of their own library.');
          }
          const moved = withFolder(item, folderId, folders);
          if (moved !== item) await store.update(moved);
        });
        dispatch({ type: 'move-to-folder', itemIds: result.done, folderId });
        return result;
      },
      deleteFolder: async (folderId) => {
        findFolder(folderId);
        const deletedAt = new Date().toISOString();
        const { folderIds, itemIds } = folderTrash(folders, allItems(state), folderId);
        // Files first: if that fails, the folder stays and still holds what's left.
        if (itemIds.length > 0) {
          const moved = await moveAll(itemIds, (ids) => store.trash(ids, deletedAt));
          dispatch({ type: 'trash-photos', photoIds: moved.done, deletedAt });
          if (moved.failed.length > 0) throw failure(moved);
        }
        await saveFolders(
          folders
            .filter((folder) => folderIds.includes(folder.id))
            .map((folder) => ({ ...folder, deletedAt })),
        );
      },
      restoreFolder: async (folderId) => {
        findFolder(folderId);
        const plan = folderRestore(folders, state.trash ?? [], folderId);
        await saveFolders(
          folders
            .filter((folder) => plan.folderIds.includes(folder.id))
            .map((folder) => {
              const back = { ...folder };
              delete back.deletedAt;
              if (folder.id === folderId && plan.moveToTop) delete back.parentId;
              return back;
            }),
        );
        if (plan.itemIds.length > 0) {
          const result = await moveAll(plan.itemIds, (ids) => store.restore(ids));
          dispatch({ type: 'restore-photos', photoIds: result.done });
          if (result.failed.length > 0) throw failure(result);
        }
      },
      deleteFolderForever: async (folderId) => {
        const folder = findFolder(folderId);
        const together = folders.filter((each) => each.deletedAt === folder.deletedAt);
        const tree = folderTree(together, folderId);
        const items = (state.trash ?? []).filter(
          (item) => item.deletedAt === folder.deletedAt && item.albumIds.some((id) => tree.has(id)),
        );
        const removed = await settleEach(items, SAVES_AT_ONCE, (item) => store.remove(item.id));
        dispatch({ type: 'delete-photos', photoIds: removed.done.map((item) => item.id) });
        if (removed.failed.length > 0) throw failure(removed);
        const gone = await settleEach([...tree], SAVES_AT_ONCE, (id) => store.removeAlbum(id));
        dispatch({ type: 'remove-folders', folderIds: gone.done });
        if (gone.failed.length > 0) throw failure(gone);
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
