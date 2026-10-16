import { createContext, useContext, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';

import { initialAlbums, initialPhotos } from '../mock/data';
import type { Album, Photo } from '../mock/data';

/**
 * In-memory vault state on mock data. Later this is backed by the API (ciphertext) and
 * decrypted in the browser; decrypted photos stay in memory, never in storage.
 */

export interface VaultState {
  photos: Photo[];
  albums: Album[];
}

export type VaultAction =
  | { type: 'toggle-favorite'; photoId: string }
  | { type: 'delete-photo'; photoId: string }
  | { type: 'add-photos'; photos: Photo[]; albumId?: string }
  | { type: 'create-album'; album: Album };

export function vaultReducer(state: VaultState, action: VaultAction): VaultState {
  switch (action.type) {
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
    case 'add-photos': {
      const { albumId } = action;
      const added = albumId
        ? action.photos.map((photo) => ({ ...photo, albumIds: [...photo.albumIds, albumId] }))
        : action.photos;
      return { ...state, photos: [...added, ...state.photos] };
    }
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

interface VaultValue {
  state: VaultState;
  dispatch: (action: VaultAction) => void;
}

const VaultContext = createContext<VaultValue | null>(null);

export function VaultProvider({
  children,
  initialState = { photos: initialPhotos, albums: initialAlbums },
}: {
  children: ReactNode;
  initialState?: VaultState;
}) {
  const [state, dispatch] = useReducer(vaultReducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <VaultContext value={value}>{children}</VaultContext>;
}

export function useVault(): VaultValue {
  const vault = useContext(VaultContext);
  if (!vault) throw new Error('useVault must be used inside VaultProvider');
  return vault;
}
