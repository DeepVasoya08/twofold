import type { SpaceKeys, UploadKeyPair } from '@arcafold/crypto';
import { STORAGE_SIZES } from '@arcafold/types';

import { ApiError, spaceApi } from '../api';
import type { SpaceApi } from '../api';
import { loadCrypto } from '../crypto-loader';
import { FormError } from '../errors';
import { isPhotoType } from '../photo-types';
import { encodePhotoMeta } from '../records';
import type { PhotoMeta } from '../records';

/**
 * Backing up while Arcafold is locked (docs/security.md, "Upload-only keys").
 *
 * The owner sets up a space's upload key once: a key pair whose secret half is kept as an
 * owner record. Each phone that backs up gets its own upload-only token and keeps only that
 * and the public half, so what it keeps can add photos but never read or change any.
 * Photos it adds are sealed for the owner, who seals them again the usual way on opening
 * the library (`remoteStore`).
 */

/** What a phone keeps to back up while locked. Nothing in it opens anything. */
export interface UploadOnly {
  /** The phone's upload-only token, sent in place of the space token. */
  token: string;
  /** The token's id, to revoke it. */
  tokenId: string;
  /** The upload key's public half, base64url. */
  publicKey: string;
}

/** A photo to back up: what `SpaceStore.add` takes, for a photo only. */
export interface BackupPhoto {
  thumb: Uint8Array<ArrayBuffer>;
  full: Uint8Array<ArrayBuffer>;
  type: string;
  width: number;
  height: number;
  takenAt: string;
}

const TOO_LARGE = 'This photo is too large to back up.';

/**
 * The space's upload key pair, opened. Null if it has none and `create` is false. When two
 * devices make one at once, the first one kept wins and the other opens it.
 */
export async function uploadKeyPair(
  space: SpaceKeys,
  api: SpaceApi,
  create: boolean,
): Promise<UploadKeyPair | null> {
  const crypto = await loadCrypto();
  const { meta } = await api.getUploadKey();
  if (meta) return crypto.openUploadKeyPair(space, meta);
  if (!create) return null;
  const pair = await crypto.newUploadKeyPair();
  try {
    await api.putUploadKey(await crypto.sealUploadKeyPair(space, pair));
    return pair;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    const kept = (await api.getUploadKey()).meta;
    if (!kept) throw error;
    return crypto.openUploadKeyPair(space, kept);
  }
}

/** Lets this phone back up to the space while locked. Needs the space's own keys. */
export async function setUpUploadOnly(
  space: SpaceKeys,
  makeApi: (token: string) => SpaceApi = spaceApi,
): Promise<UploadOnly> {
  const crypto = await loadCrypto();
  const api = makeApi(crypto.spaceToken(space));
  const pair = await uploadKeyPair(space, api, true);
  if (!pair) throw new Error('No upload key');
  const publicKey = crypto.toBase64Url(pair.publicKey);
  pair.secretKey.fill(0);
  const token = await crypto.newUploadToken();
  const tokenId = await crypto.newRecordId();
  await api.addUploadToken({ id: tokenId, token });
  return { token, tokenId, publicKey };
}

/** Stops a phone backing up: its token no longer works. */
export async function turnOffUploadOnly(
  space: SpaceKeys,
  tokenId: string,
  makeApi: (token: string) => SpaceApi = spaceApi,
): Promise<void> {
  const crypto = await loadCrypto();
  await makeApi(crypto.spaceToken(space)).removeUploadToken(tokenId);
}

/**
 * Adds one photo with only what a phone keeps while locked. Its key and details are sealed
 * to the upload key, so this phone can't read them back; the owner's next unlock does.
 * There's no fingerprint (that needs the records key), and an upload cut short is left for
 * the server to clear after a day, since this token can't delete. Returns the photo's id.
 */
export async function addForOwner(
  target: UploadOnly,
  photo: BackupPhoto,
  makeApi: (token: string) => SpaceApi = spaceApi,
): Promise<string> {
  const crypto = await loadCrypto();
  if (!isPhotoType(photo.type)) throw new FormError('Arcafold can’t store this kind of file.');
  if (crypto.encryptedFileSize(photo.full.length) > STORAGE_SIZES.maxFull) {
    throw new FormError(TOO_LARGE);
  }
  const publicKey = crypto.fromBase64Url(target.publicKey);
  if (!publicKey) throw new Error('Malformed upload key');
  const id = await crypto.newRecordId();
  const key = await crypto.newFileKey();
  try {
    const thumb = new Uint8Array(await crypto.encryptFile(key, photo.thumb));
    const full = new Uint8Array(await crypto.encryptLargeFile(key, photo.full));
    if (thumb.length > STORAGE_SIZES.maxThumb) throw new FormError(TOO_LARGE);
    const meta: PhotoMeta = {
      v: 1,
      key: crypto.toBase64Url(key),
      type: photo.type,
      width: photo.width,
      height: photo.height,
      takenAt: photo.takenAt,
      favorite: false,
      albumIds: [],
    };
    const api = makeApi(target.token);
    await api.createPhoto({
      id,
      meta: await crypto.sealForUpload(publicKey, 'photo', id, encodePhotoMeta(meta)),
      thumbSize: thumb.length,
      fullSize: full.length,
    });
    const puts = await Promise.all([
      api.putFile(id, 'thumb', thumb),
      api.putFile(id, 'full', full),
    ]);
    if (!puts.some((put) => put.committed)) await api.commitPhoto(id);
    return id;
  } finally {
    key.fill(0);
  }
}
