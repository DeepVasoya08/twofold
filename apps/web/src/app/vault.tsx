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

import type { SpaceKeys } from '@twofold/crypto';
import type { PhotoPart } from '@twofold/types';

import { extensionOf } from '../lib/photo-types';
import { settleEach } from '../lib/settle-each';
import type { Settled } from '../lib/settle-each';
import { FormError } from './account-ops';
import type { Space } from './account-ops';
import type { NewPhoto, SpaceStore, UploadStage } from './space-store';
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
}

export type VaultAction =
  | { type: 'loaded'; state: VaultState }
  | { type: 'set-image'; photoId: string; part: PhotoPart; url: string }
  | { type: 'set-thumbs'; urls: ReadonlyMap<string, string> }
  | { type: 'toggle-favorite'; photoId: string }
  | { type: 'delete-photos'; photoIds: readonly string[] }
  | { type: 'add-photos'; photos: Photo[] }
  | { type: 'set-details'; photoIds: readonly string[]; change: PhotoDetails }
  | { type: 'create-album'; album: Album }
  | { type: 'rename-album'; albumId: string; title: string }
  | { type: 'delete-album'; albumId: string };

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
    case 'loaded':
      return action.state;
    case 'set-image':
      return {
        ...state,
        photos: state.photos.map((photo) => {
          if (action.part === 'thumb') {
            return photo.id === action.photoId ? { ...photo, src: action.url } : photo;
          }
          if (photo.id === action.photoId) return { ...photo, fullSrc: action.url };
          // The store keeps one original at a time and has revoked the others.
          if (photo.fullSrc === undefined) return photo;
          const rest = { ...photo };
          delete rest.fullSrc;
          return rest;
        }),
      };
    case 'set-thumbs':
      return {
        ...state,
        photos: state.photos.map((photo) => {
          const url = action.urls.get(photo.id);
          return url === undefined ? photo : { ...photo, src: url };
        }),
      };
    case 'toggle-favorite':
      return {
        ...state,
        photos: state.photos.map((photo) =>
          photo.id === action.photoId ? { ...photo, favorite: !photo.favorite } : photo,
        ),
      };
    case 'delete-photos': {
      const gone = new Set(action.photoIds);
      return {
        photos: state.photos.filter((photo) => !gone.has(photo.id)),
        albums: state.albums.map((album) => {
          if (album.coverPhotoId === undefined || !gone.has(album.coverPhotoId)) return album;
          const rest = { ...album };
          delete rest.coverPhotoId;
          return rest;
        }),
      };
    }
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
      return { ...state, photos: [...action.photos, ...state.photos] };
    case 'create-album':
      return { ...state, albums: [action.album, ...state.albums] };
    case 'rename-album':
      return {
        ...state,
        albums: state.albums.map((album) =>
          album.id === action.albumId ? { ...album, title: action.title } : album,
        ),
      };
    case 'delete-album':
      return {
        photos: state.photos.map((photo) =>
          withDetails(photo, { albumId: action.albumId, included: false }),
        ),
        albums: state.albums.filter((album) => album.id !== action.albumId),
      };
  }
}

/** Photos in an album, newest first. */
export function albumPhotos(state: VaultState, albumId: string): Photo[] {
  return state.photos
    .filter((photo) => photo.albumIds.includes(albumId))
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/** Whether a photo can go in an album: both must be in the same library. */
export function fitsAlbum(photo: Photo, album: Album): boolean {
  return photo.library === album.library;
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

/**
 * Thumbnails download only once their photo is near the screen, many per request. Requests
 * made within this long of each other share a batch, and at most THUMB_REQUESTS batches are
 * downloading at once.
 */
const THUMB_GATHER_MS = 30;
const THUMB_REQUESTS = 2;
/**
 * Decrypted thumbnails reach the screen together, at most this often. One update per
 * thumbnail would redraw the whole grid once per photo, which a large library can't afford.
 */
const THUMB_FLUSH_MS = 100;
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
  upload: (
    photo: NewPhoto,
    albumId: string | undefined,
    onStage?: (stage: UploadStage) => void,
  ) => Promise<void>;
  toggleFavorite: (photoId: string) => Promise<void>;
  deletePhoto: (photoId: string) => Promise<void>;
  /** Changes to many photos: each goes through or fails on its own. */
  deletePhotos: (photoIds: readonly string[]) => Promise<Settled<string>>;
  /**
   * Sets a favorite, or puts photos in an album or takes them out, saving only the photos it
   * changes. A photo can only go in an album of its own library.
   */
  setDetails: (photoIds: readonly string[], change: DetailsChange) => Promise<Settled<string>>;
  createAlbum: (title: string) => Promise<Album>;
  renameAlbum: (albumId: string, title: string) => Promise<void>;
  /** Deletes an album and takes it out of its photos, which stay in the library. */
  deleteAlbum: (albumId: string) => Promise<void>;
  /** Decrypts photos' originals into files, for sending copies elsewhere. */
  originals: (photoIds: readonly string[]) => Promise<File[]>;
  /**
   * Moves a photo to the other space. Needs that space's keys: `Session.otherSpace`, or the
   * keys just opened for this move.
   */
  movePhoto: (photoId: string, otherKeys?: SpaceKeys) => Promise<void>;
  movePhotos: (photoIds: readonly string[], otherKeys?: SpaceKeys) => Promise<Settled<string>>;
  /** Starts decrypting a photo's original; `fullSrc` is set when it's ready. */
  loadFull: (photoId: string) => void;
  /** Asks for photos' previews, for when they come near the screen. Asking twice is free. */
  requestThumbs: (photoIds: readonly string[]) => void;
}

const VaultContext = createContext<VaultValue | null>(null);

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

  const thumbLoader = useRef<((photoIds: readonly string[]) => void) | null>(null);
  const requestThumbs = useCallback((photoIds: readonly string[]) => {
    thumbLoader.current?.(photoIds);
  }, []);

  useEffect(() => {
    if (initialState) return;
    let cancelled = false;
    // A function, so checks after an await see the cleanup's change.
    const stopped = () => cancelled;
    const loader = createThumbLoader({
      fetch: (photoIds) => store.thumbs(photoIds),
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
      const photo = state.photos.find((candidate) => candidate.id === photoId);
      if (!photo) throw new FormError('That photo isn’t in your vault anymore.');
      return photo;
    };
    const otherStoreFor = (keys: SpaceKeys | undefined) => {
      if (!keys) throw new FormError('Unlock the other space first.');
      return storeFor(keys);
    };
    const moveOne = async (otherStore: SpaceStore, photoId: string) => {
      if (find(photoId).library !== undefined) {
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
      upload: async (photo, albumId, onStage) => {
        const added = await store.add(photo, albumId ? [albumId] : [], onStage);
        dispatch({ type: 'add-photos', photos: [added] });
      },
      toggleFavorite: async (photoId) => {
        const photo = find(photoId);
        dispatch({ type: 'toggle-favorite', photoId });
        try {
          await store.update({ ...photo, favorite: !photo.favorite });
        } catch (error) {
          dispatch({ type: 'toggle-favorite', photoId });
          throw error;
        }
      },
      deletePhoto: async (photoId) => {
        await store.remove(photoId);
        dispatch({ type: 'delete-photos', photoIds: [photoId] });
      },
      deletePhotos: async (photoIds) => {
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
          const photo = find(photoId);
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
      originals: async (photoIds) => {
        const files: File[] = [];
        for (const [index, photoId] of photoIds.entries()) {
          const { full, type } = await store.read(photoId);
          const name = `twofold-${String(index + 1)}.${extensionOf(type)}`;
          files.push(new File([full], name, { type }));
        }
        return files;
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
      loadFull: (photoId) => {
        void store.image(photoId, 'full').then(
          (url) => {
            dispatch({ type: 'set-image', photoId, part: 'full', url });
          },
          () => undefined,
        );
      },
      requestThumbs,
    };
  }, [state, status, space, store, otherKeys, storeFor, requestThumbs]);

  return <VaultContext value={value}>{children}</VaultContext>;
}

const noRequests = () => undefined;

/** Asks for previews when inside a vault; does nothing outside one (as in static previews). */
export function useRequestThumbs(): VaultValue['requestThumbs'] {
  return useContext(VaultContext)?.requestThumbs ?? noRequests;
}

export function useVault(): VaultValue {
  const vault = useContext(VaultContext);
  if (!vault) throw new Error('useVault must be used inside VaultProvider');
  return vault;
}
