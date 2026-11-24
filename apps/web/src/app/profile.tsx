import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { makeProfileImage } from '../lib/profile-image';
import type { ProfilePhotoStore } from '@arcafold/core/profile-photo';
import { FormError } from '@arcafold/core/errors';

interface ProfileValue {
  /** In-memory object URL of the decrypted profile photo, or null if there is none. */
  photo: string | null;
  /** Shrinks, encrypts and saves a new photo; null removes it. */
  setPhoto: (file: Blob | null) => Promise<void>;
}

const ProfileContext = createContext<ProfileValue | null>(null);

const CANT_READ = 'Arcafold couldn’t read that photo. Try a JPEG or PNG.';

/**
 * The open space's profile photo, decrypted in memory. Mounted with the vault, so locking
 * throws it away; the object URL is revoked when it's replaced or unmounted.
 */
export function ProfileProvider({
  children,
  store,
}: {
  children: ReactNode;
  store: ProfilePhotoStore;
}) {
  const [photo, setPhotoUrl] = useState<string | null>(null);
  const current = useRef<string | null>(null);

  const show = (jpeg: Uint8Array<ArrayBuffer> | null) => {
    if (current.current) URL.revokeObjectURL(current.current);
    current.current = jpeg ? URL.createObjectURL(new Blob([jpeg], { type: 'image/jpeg' })) : null;
    setPhotoUrl(current.current);
  };

  useEffect(() => {
    let cancelled = false;
    store.load().then(
      (jpeg) => {
        if (!cancelled && jpeg) show(jpeg);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      if (current.current) URL.revokeObjectURL(current.current);
      current.current = null;
    };
  }, [store]);

  const value = useMemo<ProfileValue>(
    () => ({
      photo,
      setPhoto: async (file) => {
        if (!file) {
          await store.remove();
          show(null);
          return;
        }
        const jpeg = await makeProfileImage(file);
        if (!jpeg) throw new FormError(CANT_READ);
        await store.save(jpeg);
        show(jpeg);
      },
    }),
    [photo, store],
  );

  return <ProfileContext value={value}>{children}</ProfileContext>;
}

const noProfile: ProfileValue = {
  photo: null,
  setPhoto: () => Promise.reject(new FormError('Unlock Arcafold first.')),
};

/** The open space's profile photo; none outside a vault (as on the unlock screen). */
export function useProfile(): ProfileValue {
  return useContext(ProfileContext) ?? noProfile;
}
