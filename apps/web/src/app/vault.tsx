import { createContext, useContext, useEffect, useMemo, useReducer, useState } from 'react';
import type { ReactNode } from 'react';

import type { SpaceKeys } from '@twofold/crypto';
import type { PhotoPart } from '@twofold/types';

import { FormError } from './account-ops';
import type { Space } from './account-ops';
import type { NewPhoto, SpaceStore, UploadStage } from './space-store';
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
  | { type: 'toggle-favorite'; photoId: string }
  | { type: 'delete-photo'; photoId: string }
  | { type: 'add-photos'; photos: Photo[] }
  | { type: 'create-album'; album: Album };

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
    case 'toggle-favorite':
      return {
        ...state,
        photos: state.photos.map((photo) =>
          photo.id === action.photoId ? { ...photo, favorite: !photo.favorite } : photo,
        ),
      };
    case 'delete-photo':
      return {
        photos: state.photos.filter((photo) => photo.id !== action.photoId),
        albums: state.albums.map((album) =>
          album.coverPhotoId === action.photoId ? { id: album.id, title: album.title } : album,
        ),
      };
    case 'add-photos':
      return { ...state, photos: [...action.photos, ...state.photos] };
    case 'create-album':
      return { ...state, albums: [action.album, ...state.albums] };
  }
}

/** Photos in an album, newest first. */
export function albumPhotos(state: VaultState, albumId: string): Photo[] {
  return state.photos
    .filter((photo) => photo.albumIds.includes(albumId))
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
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

/** Thumbnails download a few at a time, newest first, so the top of the timeline fills in first. */
const THUMB_CONCURRENCY = 4;

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
  createAlbum: (title: string) => Promise<Album>;
  /**
   * Moves a photo to the other space. Needs that space's keys: `Session.otherSpace`, or the
   * keys just opened for this move.
   */
  movePhoto: (photoId: string, otherKeys?: SpaceKeys) => Promise<void>;
  /** Starts decrypting a photo's original; `fullSrc` is set when it's ready. */
  loadFull: (photoId: string) => void;
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

  useEffect(() => {
    if (initialState) return;
    let cancelled = false;
    // A function, so checks after an await see the cleanup's change.
    const stopped = () => cancelled;
    const loadThumbs = async (queue: Photo[]) => {
      for (;;) {
        const photo = queue.shift();
        if (!photo || stopped()) return;
        const url = await store.image(photo.id, 'thumb').catch(() => null);
        if (url && !stopped())
          dispatch({ type: 'set-image', photoId: photo.id, part: 'thumb', url });
      }
    };
    store.list().then(
      (loaded) => {
        if (stopped()) return;
        dispatch({ type: 'loaded', state: loaded });
        setStatus('ready');
        const queue = [...loaded.photos].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
        for (let i = 0; i < THUMB_CONCURRENCY; i++) void loadThumbs(queue);
      },
      () => {
        if (!stopped()) setStatus('failed');
      },
    );
    return () => {
      cancelled = true;
      store.dispose();
    };
  }, [store, initialState]);

  const value = useMemo<VaultValue>(() => {
    const find = (photoId: string): Photo => {
      const photo = state.photos.find((candidate) => candidate.id === photoId);
      if (!photo) throw new FormError('That photo isn’t in your vault anymore.');
      return photo;
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
        dispatch({ type: 'delete-photo', photoId });
      },
      createAlbum: async (title) => {
        const album = await store.createAlbum(title);
        dispatch({ type: 'create-album', album });
        return album;
      },
      movePhoto: async (photoId, keys = otherKeys) => {
        if (!keys) throw new FormError('Unlock the other space first.');
        const otherStore = storeFor(keys);
        find(photoId);
        // Albums belong to one space, so a moved photo arrives unfiled. It is re-encrypted
        // under a new key and id, so nothing ties the two copies together.
        await otherStore.add(await store.read(photoId), []);
        otherStore.dispose();
        await store.remove(photoId);
        dispatch({ type: 'delete-photo', photoId });
      },
      loadFull: (photoId) => {
        void store.image(photoId, 'full').then(
          (url) => {
            dispatch({ type: 'set-image', photoId, part: 'full', url });
          },
          () => undefined,
        );
      },
    };
  }, [state, status, space, store, otherKeys, storeFor]);

  return <VaultContext value={value}>{children}</VaultContext>;
}

export function useVault(): VaultValue {
  const vault = useContext(VaultContext);
  if (!vault) throw new Error('useVault must be used inside VaultProvider');
  return vault;
}
