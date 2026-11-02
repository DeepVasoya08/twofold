import type { SpaceKeys } from '@arcafold/crypto';
import { STORAGE_SIZES } from '@arcafold/types';

import { spaceApi } from '../lib/api';
import type { SpaceApi } from '../lib/api';
import { FormError } from './account-ops';

/**
 * The open space's profile photo, stored like a photo: the image is encrypted under a key
 * of its own, and that key is sealed in an owner-only record. Each space keeps its own, so
 * the main library's photo says nothing about whether a private space exists.
 */
export interface ProfilePhotoStore {
  /** The decrypted JPEG, or null if there is none (or it doesn't decrypt). */
  load: () => Promise<Uint8Array<ArrayBuffer> | null>;
  save: (jpeg: Uint8Array<ArrayBuffer>) => Promise<void>;
  remove: () => Promise<void>;
}

const loadCrypto = () => import('@arcafold/crypto');

interface ProfileMeta {
  v: 1;
  /** The image's file key, base64url. */
  key: string;
}

function parseMeta(bytes: Uint8Array): ProfileMeta | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof value !== 'object' || value === null) return null;
    const { v, key } = value as Record<string, unknown>;
    return v === 1 && typeof key === 'string' ? { v, key } : null;
  } catch {
    return null;
  }
}

const TOO_LARGE = 'That photo is too large for a profile photo. Try another one.';

export function remoteProfilePhoto(
  space: SpaceKeys,
  makeApi: (token: string) => SpaceApi = spaceApi,
): ProfilePhotoStore {
  const remote = async () => makeApi((await loadCrypto()).spaceToken(space));
  return {
    load: async () => {
      const { photo } = await (await remote()).getProfilePhoto();
      if (!photo) return null;
      const crypto = await loadCrypto();
      try {
        const opened = await crypto.openOwnerRecord(space, 'profile', photo.id, photo.meta);
        const meta = parseMeta(opened);
        const key = meta && crypto.fromBase64Url(meta.key);
        const image = crypto.fromBase64Url(photo.image);
        if (key?.length !== 32 || !image) return null;
        return new Uint8Array(await crypto.decryptFile(key, image));
      } catch {
        // Tampered with, or not this space's: show no photo rather than someone else's.
        return null;
      }
    },
    save: async (jpeg) => {
      const crypto = await loadCrypto();
      const id = await crypto.newRecordId();
      const key = await crypto.newFileKey();
      const image = await crypto.encryptFile(key, jpeg);
      if (image.length > STORAGE_SIZES.maxProfilePhoto) throw new FormError(TOO_LARGE);
      const meta: ProfileMeta = { v: 1, key: crypto.toBase64Url(key) };
      const sealed = await crypto.sealOwnerRecord(
        space,
        'profile',
        id,
        new TextEncoder().encode(JSON.stringify(meta)),
      );
      await (
        await remote()
      ).putProfilePhoto({ id, meta: sealed, image: crypto.toBase64Url(image) });
    },
    remove: async () => {
      await (await remote()).deleteProfilePhoto();
    },
  };
}

/** Keeps the photo in memory only: for previews and rendering tests. */
export function memoryProfilePhoto(): ProfilePhotoStore {
  let stored: Uint8Array<ArrayBuffer> | null = null;
  return {
    load: () => Promise.resolve(stored),
    save: (jpeg) => {
      stored = jpeg;
      return Promise.resolve();
    },
    remove: () => {
      stored = null;
      return Promise.resolve();
    },
  };
}
