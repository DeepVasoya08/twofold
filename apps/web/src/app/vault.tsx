import { createContext, useContext, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';

import {
  MOCK_PRIVATE_PASSWORD,
  initialAlbums,
  initialPhotos,
  initialPrivateAlbums,
  initialPrivatePhotos,
} from '../mock/data';
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

/** The main library, or the private space that only the private password opens. */
export type Space = 'main' | 'private';

export interface VaultsState {
  /** The space the current password opened. */
  space: Space;
  spaces: Record<Space, VaultState>;
  /**
   * Mock only: the private password, kept in memory so the demo opens the space with whatever
   * was chosen in Settings. Real unlocking derives keys in packages/crypto and keeps no
   * password anywhere. The main library never shows whether this is set.
   */
  privatePassword: string | null;
}

export type VaultsAction =
  | { type: 'in-space'; action: VaultAction }
  | { type: 'move-photo'; photoId: string; to: Space }
  | { type: 'open-space'; space: Space }
  | { type: 'set-up-private'; password: string };

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
        ...state,
        spaces: withSpace(
          state.spaces,
          state.space,
          vaultReducer(state.spaces[state.space], action.action),
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
        ...state,
        spaces: withSpace(
          removed,
          action.to,
          vaultReducer(state.spaces[action.to], { type: 'add-photos', photos: [moved] }),
        ),
      };
    }
    case 'open-space':
      return { ...state, space: action.space };
    case 'set-up-private':
      return { ...state, privatePassword: action.password };
  }
}

/**
 * Which space a password opens (mock). The same password box serves both, so nothing on
 * screen reveals whether a private space exists.
 */
export function spaceForPassword(password: string, privatePassword: string | null): Space {
  return privatePassword !== null && password === privatePassword ? 'private' : 'main';
}

export const initialVaults: VaultsState = {
  space: 'main',
  spaces: {
    main: { photos: initialPhotos, albums: initialAlbums },
    private: { photos: initialPrivatePhotos, albums: initialPrivateAlbums },
  },
  privatePassword: MOCK_PRIVATE_PASSWORD,
};

interface VaultValue {
  /** Photos and albums of the open space. */
  state: VaultState;
  /** Applies an action to the open space. */
  dispatch: (action: VaultAction) => void;
  space: Space;
  /** The space this password opens. */
  spaceFor: (password: string) => Space;
  movePhoto: (photoId: string, to: Space) => void;
  openSpace: (space: Space) => void;
  /** Sets or replaces the private password (mock). */
  setPrivatePassword: (password: string) => void;
}

const VaultContext = createContext<VaultValue | null>(null);

export function VaultProvider({
  children,
  initialState = initialVaults,
}: {
  children: ReactNode;
  initialState?: VaultsState;
}) {
  const [vaults, dispatchVaults] = useReducer(vaultsReducer, initialState);
  const value = useMemo<VaultValue>(
    () => ({
      state: vaults.spaces[vaults.space],
      dispatch: (action) => {
        dispatchVaults({ type: 'in-space', action });
      },
      space: vaults.space,
      spaceFor: (password) => spaceForPassword(password, vaults.privatePassword),
      movePhoto: (photoId, to) => {
        dispatchVaults({ type: 'move-photo', photoId, to });
      },
      openSpace: (space) => {
        dispatchVaults({ type: 'open-space', space });
      },
      setPrivatePassword: (password) => {
        dispatchVaults({ type: 'set-up-private', password });
      },
    }),
    [vaults],
  );
  return <VaultContext value={value}>{children}</VaultContext>;
}

export function useVault(): VaultValue {
  const vault = useContext(VaultContext);
  if (!vault) throw new Error('useVault must be used inside VaultProvider');
  return vault;
}
