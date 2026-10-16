/** Response body of the API health check (`GET /health`). */
export interface HealthResponse {
  status: 'ok';
}

/** Error body every failing API route returns. The message is safe to show to the user. */
export interface ErrorResponse {
  error: string;
}

/**
 * Byte sizes of the key material the browser sends. The API checks lengths against these;
 * packages/crypto produces values of exactly these sizes. Binary values travel as unpadded
 * base64url.
 */
export const KEY_SIZES = {
  salt: 16,
  /** A sealed key slot: nonce (24) + MAC (16) + space key (32) + space id (16). */
  slot: 88,
  /** A login key, and the SHA-256 verifier the server keeps of it. */
  loginKey: 32,
  verifier: 32,
} as const;

/**
 * Every account has exactly this many key slots, in this order: main password, recovery
 * key, private password. A slot that is not in use holds random bytes, which look the same
 * as a sealed slot, so nobody can tell from the keyring whether a private space exists.
 */
export const SLOT_COUNT = 3;

export type Slots = [string, string, string];

/** Argon2id cost parameters, kept with the account so they can be raised later. */
export interface KdfParams {
  opsLimit: number;
  memLimit: number;
}

/** Everything the server keeps about an account's keys. None of it is readable without a password. */
export interface Keyring {
  salt: string;
  kdf: KdfParams;
  slots: Slots;
  /** SHA-256 of each slot's login key, so the server can check a login without learning keys. */
  verifiers: Slots;
}

/** The account as the signed-in browser sees it. */
export interface AccountResponse {
  email: string;
  name: string;
  /** Bumped on every keyring change; updates must name the version they started from. */
  version: number;
  keyring: Keyring;
}

export interface SignUpRequest {
  email: string;
  name: string;
  keyring: Keyring;
}

export interface PreLoginRequest {
  email: string;
}

/** What the browser needs to turn a password into a login key. */
export interface PreLoginResponse {
  salt: string;
  kdf: KdfParams;
}

export interface LoginRequest {
  email: string;
  /** Login key derived from the main password, the private password, or the recovery key. */
  loginKey: string;
}

/** Replaces the whole keyring. Sending all slots every time hides which one changed. */
export interface UpdateKeyringRequest {
  /** Proves the caller knows a password (or the recovery key), not just the session cookie. */
  loginKey: string;
  version: number;
  keyring: Keyring;
}

export interface DeleteAccountRequest {
  loginKey: string;
}

/**
 * Photo storage. A space's storage is addressed by its access token (the space id from its
 * key slot), sent in this header. The server keeps only the token's SHA-256 and never links
 * a space to an account, so it cannot tell whose space it is or how many an account has.
 */
export const SPACE_HEADER = 'x-twofold-space';

export const STORAGE_SIZES = {
  /** The space access token: the space id from the key slot. */
  spaceToken: 16,
  /** Photo and album ids are random, chosen by the browser. */
  recordId: 16,
  /** Largest sealed record (photo or album metadata), in bytes before base64url. */
  maxRecord: 2048,
  /** Largest encrypted thumbnail and full-size photo, in bytes. */
  maxThumb: 1024 * 1024,
  maxFull: 64 * 1024 * 1024,
} as const;

/** Which encrypted file of a photo: a small preview, or the original. */
export type PhotoPart = 'thumb' | 'full';

/** A photo as stored: an id, sealed metadata (which holds the photo's key) and file sizes. */
export interface StoredPhoto {
  id: string;
  meta: string;
  thumbSize: number;
  fullSize: number;
}

export interface StoredAlbum {
  id: string;
  meta: string;
}

/** One page of a space's photos. `next` is the cursor for the following page, if any. */
export interface PhotoPage {
  photos: StoredPhoto[];
  next: string | null;
}

export interface AlbumList {
  albums: StoredAlbum[];
}

/** Starts a photo upload. The two files follow with PUT, then a commit makes it visible. */
export type CreatePhotoRequest = StoredPhoto;

export type CreateAlbumRequest = StoredAlbum;

/** Replaces a photo's or album's sealed metadata (favorites, albums, titles). */
export interface UpdateRecordRequest {
  meta: string;
}
