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

/** Changes the name shown on the account. Names are not secret: sign-up sends one too. */
export interface UpdateNameRequest {
  name: string;
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
  /** Most encrypted bytes one account can upload and keep, across every space. */
  accountQuota: 1024 * 1024 * 1024,
  /** Largest encrypted profile photo, in bytes. The browser shrinks photos well below this. */
  maxProfilePhoto: 128 * 1024,
} as const;

/**
 * Most thumbnails one `GET /space/thumbs?ids=a,b,c` returns. The response is the encrypted
 * thumbnails in the order asked, each as a 4-byte big-endian length and then its bytes; a
 * length of 0 means that photo isn't there (deleted, still uploading, or another space's).
 */
export const THUMB_BATCH_MAX = 48;

/**
 * Splits a thumbnail batch response into one entry per id asked for, in order: the encrypted
 * thumbnail, or null where the server had none. Returns null if the response is malformed.
 */
export function readThumbBatch(
  bytes: Uint8Array<ArrayBuffer>,
  count: number,
): (Uint8Array<ArrayBuffer> | null)[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: (Uint8Array<ArrayBuffer> | null)[] = [];
  let offset = 0;
  while (parts.length < count) {
    if (offset + 4 > bytes.length) return null;
    const length = view.getUint32(offset);
    offset += 4;
    if (offset + length > bytes.length) return null;
    parts.push(length === 0 ? null : bytes.slice(offset, offset + length));
    offset += length;
  }
  return offset === bytes.length ? parts : null;
}

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

/**
 * A space's profile photo: the image encrypted under its own file key, and that key in an
 * owner-only sealed record. Each space has its own, so one never hints at the other.
 */
export interface StoredProfilePhoto {
  id: string;
  meta: string;
  /** The encrypted image, base64url. */
  image: string;
}

export interface ProfilePhotoResponse {
  photo: StoredProfilePhoto | null;
}

/** Starts a photo upload. The two files follow with PUT, then a commit makes it visible. */
export type CreatePhotoRequest = StoredPhoto;

export type CreateAlbumRequest = StoredAlbum;

/** Replaces a photo's or album's sealed metadata (favorites, albums, titles). */
export interface UpdateRecordRequest {
  meta: string;
}

/**
 * Sharing. A space is shared by giving another account a share token of its own (sent in
 * SPACE_HEADER instead of the space id) and the space's records key. Who a space is shared
 * with, and which libraries it has joined, are sealed records only the space's owner opens.
 */
export const SHARE_SIZES = {
  /** A crypto_box public key, and the BLAKE2b commitment to one. */
  publicKey: 32,
  commitment: 32,
  /** The inviter's private handle on its invite. */
  handle: 16,
  /** Largest sealed message between the two sides of an invite, in bytes. */
  maxMessage: 1024,
} as const;

/** An invite works once and only for this long. */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

/** Most people one space can be shared with, and most libraries one space can join. */
export const MAX_MEMBERS = 20;
export const MAX_JOINED = 50;

/**
 * Starts an invite. The joiner will use `code`; the inviter keeps `handle` to itself and uses
 * it for its own steps. `commitment` binds the inviter's public key before it is revealed.
 */
export interface CreateInviteRequest {
  code: string;
  handle: string;
  commitment: string;
}

/** What the inviter sees of its invite as it progresses. */
export interface InviterView {
  joinerKey: string | null;
  /** The joiner's name, sealed to the inviter's key. */
  hello: string | null;
}

/** What the joiner sees of the invite as it progresses. */
export interface JoinerView {
  commitment: string;
  inviterKey: string | null;
  /** The access, sealed to the joiner's key, once the inviter confirms. */
  grant: string | null;
}

export interface JoinInviteRequest {
  joinerKey: string;
}

export interface HelloRequest {
  hello: string;
}

export interface RevealRequest {
  inviterKey: string;
}

export interface GrantRequest {
  grant: string;
}

/** Someone a space is shared with: a random id and who they are, sealed for the owner. */
export interface StoredMember {
  id: string;
  meta: string;
}

/** Shares a space: the member's own token (stored hashed) and their sealed details. */
export interface CreateMemberRequest {
  id: string;
  token: string;
  meta: string;
}

export interface MemberList {
  members: StoredMember[];
}

/** A library this space has joined: its share token and records key, sealed for the owner. */
export type StoredJoined = StoredAlbum;

export type CreateJoinedRequest = StoredJoined;

export interface JoinedList {
  joined: StoredJoined[];
}
