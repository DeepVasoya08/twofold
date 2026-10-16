import { createContext, useContext, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';

import type { Space } from './account-ops';
import {
  initialAlbums,
  initialPhotos,
  initialPrivateAlbums,
  initialPrivatePhotos,
} from '../mock/data';
import type { Album, Photo } from '../mock/data';

/**
 * In-memory vault state. Later this is backed by the API (ciphertext) and decrypted in the
 * browser; decrypted photos stay in memory, never in storage.
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

/** The main library, or the private space that only the private password opens. */
export type { Space } from './account-ops';

/**
 * Photos and albums of both spaces. Which one is open comes from the account (the slot the
 * password opened), not from here.
 */
export interface VaultsState {
  spaces: Record<Space, VaultState>;
}

export type VaultsAction =
  | { type: 'in-space'; space: Space; action: VaultAction }
  | { type: 'move-photo'; photoId: string; to: Space };

function otherSpace(space: Space): Space {
  return space === 'main' ? 'private' : 'main';
}

function withSpace(
  spaces: Record<Space, VaultState>,
  space: Space,
  value: VaultState,
): Record<Space, VaultState> {
  return space === 'main' ? { ...spaces, main: value } : { ...spaces, private: value };
}

export function vaultsReducer(state: VaultsState, action: VaultsAction): VaultsState {
  switch (action.type) {
    case 'in-space':
      return {
        spaces: withSpace(
          state.spaces,
          action.space,
          vaultReducer(state.spaces[action.space], action.action),
        ),
      };
    case 'move-photo': {
      const from = otherSpace(action.to);
      const photo = state.spaces[from].photos.find((candidate) => candidate.id === action.photoId);
      if (!photo) return state;
      // Albums belong to one space, so a moved photo arrives unfiled.
      const moved = { ...photo, albumIds: [] };
      const removed = withSpace(
        state.spaces,
        from,
        vaultReducer(state.spaces[from], { type: 'delete-photo', photoId: photo.id }),
      );
      return {
        spaces: withSpace(
          removed,
          action.to,
          vaultReducer(state.spaces[action.to], { type: 'add-photos', photos: [moved] }),
        ),
      };
    }
  }
}

/** A new session starts empty. Photo storage is not wired up yet, so uploads live in memory. */
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

interface VaultValue {
  /** Photos and albums of the open space. */
  state: VaultState;
  /** Applies an action to the open space. */
  dispatch: (action: VaultAction) => void;
  space: Space;
  movePhoto: (photoId: string, to: Space) => void;
}

const VaultContext = createContext<VaultValue | null>(null);

/**
 * Decrypted photos for the open session, in memory only. Mount it with a key that changes
 * whenever keys are dropped, so locking throws everything away.
 */
export function VaultProvider({
  children,
  space,
  initialState = emptyVaults,
}: {
  children: ReactNode;
  space: Space;
  initialState?: VaultsState;
}) {
  const [vaults, dispatchVaults] = useReducer(vaultsReducer, initialState);
  const value = useMemo<VaultValue>(
    () => ({
      state: vaults.spaces[space],
      dispatch: (action) => {
        dispatchVaults({ type: 'in-space', space, action });
      },
      space,
      movePhoto: (photoId, to) => {
        dispatchVaults({ type: 'move-photo', photoId, to });
      },
    }),
    [vaults, space],
  );
  return <VaultContext value={value}>{children}</VaultContext>;
}

export function useVault(): VaultValue {
  const vault = useContext(VaultContext);
  if (!vault) throw new Error('useVault must be used inside VaultProvider');
  return vault;
}
