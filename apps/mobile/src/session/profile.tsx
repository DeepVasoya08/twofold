import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { Session } from '@arcafold/core/account';
import { FormError } from '@arcafold/core/errors';
import { remoteProfilePhoto } from '@arcafold/core/profile-photo';
import type { ProfilePhotoStore } from '@arcafold/core/profile-photo';

import { MemoryImages, PhotoPicker } from '../../modules/memory-image';

/** A profile photo is this many pixels square, as the web makes it. */
export const PROFILE_SIDE = 256;
const PROFILE_QUALITY = 85;

interface ProfileValue {
  /** The open space's profile photo, held in native memory, or null if there is none. */
  imageId: string | null;
  /** Encrypts and saves a new photo (a square JPEG); null removes it. */
  save: (jpeg: Uint8Array<ArrayBuffer> | null) => Promise<void>;
}

const ProfileContext = createContext<ProfileValue | null>(null);

/**
 * The open space's profile photo, decrypted into native memory only, as the web keeps it as
 * an object URL. Mounted with the library, so locking throws it away. Each space keeps its
 * own, so the main library's photo says nothing about a private space.
 */
export function ProfileProvider({ session, children }: { session: Session; children: ReactNode }) {
  const store = useMemo<ProfilePhotoStore>(
    () => remoteProfilePhoto(session.opened.space),
    [session.opened.space],
  );
  const [imageId, setImageId] = useState<string | null>(null);
  const current = useRef<string | null>(null);

  const show = (jpeg: Uint8Array | null) => {
    if (current.current) MemoryImages.release(current.current);
    current.current = jpeg ? MemoryImages.put(jpeg) : null;
    setImageId(current.current);
  };

  useEffect(() => {
    let live = true;
    store.load().then(
      (jpeg) => {
        if (live && jpeg) show(jpeg);
      },
      () => undefined,
    );
    return () => {
      live = false;
      if (current.current) MemoryImages.release(current.current);
      current.current = null;
    };
  }, [store]);

  const value = useMemo<ProfileValue>(
    () => ({
      imageId,
      save: async (jpeg) => {
        if (jpeg) await store.save(jpeg);
        else await store.remove();
        show(jpeg);
      },
    }),
    [imageId, store],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

const noProfile: ProfileValue = {
  imageId: null,
  save: () => Promise.reject(new FormError('Unlock Arcafold first.')),
};

/** The open space's profile photo; none outside the library. */
export function useProfile(): ProfileValue {
  return useContext(ProfileContext) ?? noProfile;
}

const CANT_READ = 'Arcafold couldn’t read that photo. Try another one.';

/**
 * Lets you pick one photo from the phone and makes the square JPEG a profile photo is, in
 * memory. Resolves with null if you didn't pick one.
 */
export async function pickProfilePhoto(
  onSystemScreen: <T>(task: () => Promise<T>) => Promise<T>,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const picked = (await onSystemScreen(() => PhotoPicker.pickOneAsync())).at(0);
  if (!picked) return null;
  try {
    return new Uint8Array(await PhotoPicker.squareAsync(picked.uri, PROFILE_SIDE, PROFILE_QUALITY));
  } catch {
    throw new FormError(CANT_READ);
  }
}
