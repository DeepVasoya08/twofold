import { FACE_SIZES, SEARCH_SIZES, STORAGE_SIZES } from '@arcafold/types';

import type { SpaceKeys } from './keyring';
import { getSodium } from './sodium';
import { fromBase64Url, toBase64Url } from './webcrypto';

/**
 * Photo storage encryption.
 *
 * - Every photo has its own random key. Its two files (thumbnail and original) are each
 *   encrypted with crypto_secretstream_xchacha20poly1305 in 64 KiB chunks, so truncation,
 *   reordering and tampering are all detected.
 * - Records (a photo's metadata, which holds its key, and albums) are sealed with
 *   crypto_aead_xchacha20poly1305_ietf under a subkey of the space key. The record's kind
 *   and id are the associated data, so the server can't swap one record for another.
 *   Plaintext is padded (ISO/IEC 7816-4, 256-byte blocks) to hide small length changes.
 * - A space's storage is addressed by an access token: the space id from its key slot for
 *   the owner, or a share token for a member. Members get the records key, never the space
 *   key, so records only the owner should read (sharing details) use a second subkey.
 */

const KDF_CONTEXT = 'arcspace';
const SUBKEY = { records: 1, owner: 2, faces: 3, search: 4 } as const;
const CHUNK_BYTES = 64 * 1024;
const PAD_BLOCK = 256;
/**
 * Face and search segments are padded to 16 KiB steps, so their size says little about
 * what's inside.
 */
const SEGMENT_PAD_BLOCK = 16 * 1024;
const RECORD_KEY_BYTES = 32;

/** Records everyone with access to a space can open: photos and albums. */
export type RecordKind = 'photo' | 'album';

/**
 * Records only the space's owner can open: who it is shared with, the libraries it has
 * joined, the key of its profile photo, invites still in progress (either side's secret key
 * for one invite), people (a name and the faces confirmed or turned down), words taught to
 * search (a name and the photos that show it), smart albums (a saved search), and the secret
 * half of the upload-only key. They use a subkey that members never receive.
 */
export type OwnerRecordKind =
  'member' | 'joined' | 'profile' | 'invite' | 'person' | 'word' | 'smart-album' | 'upload-key';

/** Segments of results worked out on the device: faces found, and photos' search vectors. */
export type SegmentKind = 'faces' | 'search';

/** What's sealed under a space's own key: its records, and segments of results. */
type SealedKind = RecordKind | OwnerRecordKind | SegmentKind;

interface Sealing {
  padBlock: number;
  maxBytes: number;
}

const RECORD_SEALING: Sealing = { padBlock: PAD_BLOCK, maxBytes: STORAGE_SIZES.maxRecord };

export class DecryptionError extends Error {
  constructor(message = 'This data could not be decrypted') {
    super(message);
    this.name = 'DecryptionError';
  }
}

/**
 * What reading and writing a space's photos and albums needs: a token that addresses its
 * storage and the key its records are sealed with. The owner's token is the space id; a
 * member's is a share token of their own, which the owner can revoke. Neither includes the
 * space key itself, so a member can't open the owner's records.
 */
export interface SpaceAccess {
  token: string;
  recordKey: Uint8Array;
}

/** The token that addresses a space's storage. The server stores only its SHA-256. */
export function spaceToken(space: SpaceKeys): string {
  if (space.spaceId.length !== STORAGE_SIZES.spaceToken) throw new Error('Malformed space id');
  return toBase64Url(space.spaceId);
}

/** The owner's access to a space: its own token and records key. */
export async function ownerAccess(space: SpaceKeys): Promise<SpaceAccess> {
  const sodium = await getSodium();
  return {
    token: spaceToken(space),
    recordKey: sodium.crypto_kdf_derive_from_key(
      RECORD_KEY_BYTES,
      SUBKEY.records,
      KDF_CONTEXT,
      space.spaceKey,
    ),
  };
}

/** A member's access to someone else's space, as their invite delivered it. */
export function memberAccess(token: string, recordKey: Uint8Array): SpaceAccess {
  if (fromBase64Url(token)?.length !== STORAGE_SIZES.spaceToken) {
    throw new Error('Malformed share token');
  }
  if (recordKey.length !== RECORD_KEY_BYTES) throw new Error('Malformed records key');
  return { token, recordKey: recordKey.slice() };
}

/**
 * A new random key for one shared album. The album's title and its photos' details are
 * sealed under it again for the people it's shared with, who get this key and never the
 * space's records key, so they can open that album's photos and nothing else.
 */
export async function newAlbumKey(): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_kdf_keygen();
}

/**
 * Access to one album someone shared: a token limited to that album, and the album's key.
 * Its records seal and open like a space's, under the album key in place of the records key.
 */
export function albumAccess(token: string, albumKey: Uint8Array): SpaceAccess {
  return memberAccess(token, albumKey);
}

/** A new random photo or album id. */
export async function newRecordId(): Promise<string> {
  const sodium = await getSodium();
  return toBase64Url(sodium.randombytes_buf(STORAGE_SIZES.recordId));
}

const FINGERPRINT_CONTEXT = 'arcprint';
const FINGERPRINT_BYTES = 32;

/**
 * A photo's fingerprint in one space: a keyed BLAKE2b hash (crypto_generichash) of its
 * original, under a subkey of the space's records key. The same photo always gets the same
 * fingerprint in the same space, so an import can tell which photos are already there; with
 * a different key it says nothing about the photo. It is only ever stored inside the photo's
 * sealed metadata, so the server never sees it.
 */
export async function photoFingerprint(access: SpaceAccess, original: Uint8Array): Promise<string> {
  if (access.recordKey.length !== RECORD_KEY_BYTES) throw new Error('Malformed records key');
  const sodium = await getSodium();
  const key = sodium.crypto_kdf_derive_from_key(
    sodium.crypto_generichash_KEYBYTES,
    1,
    FINGERPRINT_CONTEXT,
    access.recordKey,
  );
  try {
    return toBase64Url(sodium.crypto_generichash(FINGERPRINT_BYTES, original, key));
  } finally {
    sodium.memzero(key);
  }
}

function associatedData(kind: SealedKind, id: string): Uint8Array {
  return new TextEncoder().encode(`arcafold:${kind}:${id}`);
}

async function sealWith(
  key: Uint8Array,
  kind: SealedKind,
  id: string,
  data: Uint8Array,
  sealing = RECORD_SEALING,
): Promise<string> {
  const sodium = await getSodium();
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const padded = sodium.pad(data, sealing.padBlock);
  const box = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    padded,
    associatedData(kind, id),
    null,
    nonce,
    key,
  );
  const sealed = new Uint8Array(nonce.length + box.length);
  sealed.set(nonce, 0);
  sealed.set(box, nonce.length);
  if (sealed.length > sealing.maxBytes) throw new Error('This record is too large');
  return toBase64Url(sealed);
}

async function openWith(
  key: Uint8Array,
  kind: SealedKind,
  id: string,
  sealedText: string,
  sealing = RECORD_SEALING,
): Promise<Uint8Array> {
  const sodium = await getSodium();
  const sealed = fromBase64Url(sealedText);
  const nonceBytes = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
  if (!sealed || sealed.length < nonceBytes + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES) {
    throw new DecryptionError();
  }
  try {
    const padded = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      sealed.subarray(nonceBytes),
      associatedData(kind, id),
      sealed.subarray(0, nonceBytes),
      key,
    );
    return sodium.unpad(padded, sealing.padBlock);
  } catch {
    throw new DecryptionError();
  }
}

/** Seals a record's bytes under the space's records key, bound to its kind and id. */
export function sealRecord(
  access: SpaceAccess,
  kind: RecordKind,
  id: string,
  data: Uint8Array,
): Promise<string> {
  return sealWith(access.recordKey, kind, id, data);
}

/** Opens a sealed record. Throws DecryptionError if it was tampered with or belongs elsewhere. */
export function openRecord(
  access: SpaceAccess,
  kind: RecordKind,
  id: string,
  sealedText: string,
): Promise<Uint8Array> {
  return openWith(access.recordKey, kind, id, sealedText);
}

async function subkey(space: SpaceKeys, id: number): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_kdf_derive_from_key(RECORD_KEY_BYTES, id, KDF_CONTEXT, space.spaceKey);
}

const ownerKey = (space: SpaceKeys) => subkey(space, SUBKEY.owner);

/** Seals a record only the space's owner can open (members never get this subkey). */
export async function sealOwnerRecord(
  space: SpaceKeys,
  kind: OwnerRecordKind,
  id: string,
  data: Uint8Array,
): Promise<string> {
  const sodium = await getSodium();
  const key = await ownerKey(space);
  try {
    return await sealWith(key, kind, id, data);
  } finally {
    sodium.memzero(key);
  }
}

/** Opens an owner-only record. Throws DecryptionError if it doesn't open. */
export async function openOwnerRecord(
  space: SpaceKeys,
  kind: OwnerRecordKind,
  id: string,
  sealedText: string,
): Promise<Uint8Array> {
  const sodium = await getSodium();
  const key = await ownerKey(space);
  try {
    return await openWith(key, kind, id, sealedText);
  } finally {
    sodium.memzero(key);
  }
}

const SEGMENT_SEALING: Record<SegmentKind, Sealing> = {
  faces: { padBlock: SEGMENT_PAD_BLOCK, maxBytes: FACE_SIZES.maxSegment },
  search: { padBlock: SEGMENT_PAD_BLOCK, maxBytes: SEARCH_SIZES.maxSegment },
};

/**
 * Seals a segment of results under a subkey of the space key that members never receive,
 * one subkey per kind, bound to the segment's id. Padded to 16 KiB steps, so its size
 * doesn't show how many photos or faces it holds.
 */
async function sealSegment(
  space: SpaceKeys,
  kind: SegmentKind,
  id: string,
  data: Uint8Array,
): Promise<string> {
  const sodium = await getSodium();
  const key = await subkey(space, SUBKEY[kind]);
  try {
    return await sealWith(key, kind, id, data, SEGMENT_SEALING[kind]);
  } finally {
    sodium.memzero(key);
  }
}

async function openSegment(
  space: SpaceKeys,
  kind: SegmentKind,
  id: string,
  sealedText: string,
): Promise<Uint8Array> {
  const sodium = await getSodium();
  const key = await subkey(space, SUBKEY[kind]);
  try {
    return await openWith(key, kind, id, sealedText, SEGMENT_SEALING[kind]);
  } finally {
    sodium.memzero(key);
  }
}

/** Seals a segment of face results (which faces each photo has, and their fingerprints). */
export function sealFaceSegment(space: SpaceKeys, id: string, data: Uint8Array): Promise<string> {
  return sealSegment(space, 'faces', id, data);
}

/** Opens a face segment. Throws DecryptionError if it doesn't open. */
export function openFaceSegment(
  space: SpaceKeys,
  id: string,
  sealedText: string,
): Promise<Uint8Array> {
  return openSegment(space, 'faces', id, sealedText);
}

/** Seals a segment of search vectors (what each photo shows, as numbers for Smart search). */
export function sealSearchSegment(space: SpaceKeys, id: string, data: Uint8Array): Promise<string> {
  return sealSegment(space, 'search', id, data);
}

/** Opens a search segment. Throws DecryptionError if it doesn't open. */
export function openSearchSegment(
  space: SpaceKeys,
  id: string,
  sealedText: string,
): Promise<Uint8Array> {
  return openSegment(space, 'search', id, sealedText);
}

/** A new random key for one photo's files. */
export async function newFileKey(): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_secretstream_xchacha20poly1305_keygen();
}

const HEADER_BYTES = 24;
const ABYTES = 17;

/** Size of a file of `plainSize` bytes once encrypted with encryptFile. */
export function encryptedFileSize(plainSize: number): number {
  const chunks = Math.max(1, Math.ceil(plainSize / CHUNK_BYTES));
  return HEADER_BYTES + plainSize + chunks * ABYTES;
}

/** Encrypts a whole file with secretstream. The last chunk carries the FINAL tag. */
export async function encryptFile(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
  const out = new Uint8Array(encryptedFileSize(data.length));
  out.set(header, 0);
  let offset = header.length;
  let position = 0;
  do {
    const end = Math.min(position + CHUNK_BYTES, data.length);
    const last = end === data.length;
    const chunk = sodium.crypto_secretstream_xchacha20poly1305_push(
      state,
      data.subarray(position, end),
      null,
      last
        ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
        : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
    );
    out.set(chunk, offset);
    offset += chunk.length;
    position = end;
  } while (position < data.length);
  return out;
}

/**
 * Decrypts a file made by encryptFile. Throws DecryptionError for a wrong key, any changed
 * byte, a missing final chunk or extra bytes after it.
 */
export async function decryptFile(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  if (data.length < HEADER_BYTES + ABYTES) throw new DecryptionError();
  let state;
  try {
    state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(
      data.subarray(0, HEADER_BYTES),
      key,
    );
  } catch {
    throw new DecryptionError();
  }
  const out = new Uint8Array(data.length - HEADER_BYTES);
  let written = 0;
  let offset = HEADER_BYTES;
  let finished = false;
  while (offset < data.length) {
    if (finished) throw new DecryptionError();
    const end = Math.min(offset + CHUNK_BYTES + ABYTES, data.length);
    let result: { message: Uint8Array; tag: number } | false;
    try {
      result = sodium.crypto_secretstream_xchacha20poly1305_pull(
        state,
        data.subarray(offset, end),
        null,
      );
    } catch {
      result = false;
    }
    if (!result) throw new DecryptionError();
    out.set(result.message, written);
    written += result.message.length;
    offset = end;
    finished = result.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL;
  }
  if (!finished) throw new DecryptionError();
  return out.slice(0, written);
}

/**
 * Upload-only keys, so a phone can back up photos while Arcafold is locked.
 *
 * The owner makes one crypto_box key pair per space. Its secret half is kept only as an
 * owner record (sealed under the owner subkey, so members never get it); a phone keeps the
 * public half. With it the phone seals new photos' records so that only the owner can open
 * them, and it can't open them (or anything else in the space) itself.
 *
 * A record sealed for upload is a fresh random key sealed to the public key with
 * crypto_box_seal, followed by the record sealed under that key exactly as sealRecord does
 * (XChaCha20-Poly1305, bound to its kind and id). The owner opens it, then seals it again
 * under the records key, so everyone else reads it the usual way.
 */
export interface UploadKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** The fixed id of a space's upload key record: there is only ever one. */
export const UPLOAD_KEY_ID = 'upload-key';

/** A new upload-only key pair for a space. */
export async function newUploadKeyPair(): Promise<UploadKeyPair> {
  const sodium = await getSodium();
  const pair = sodium.crypto_box_keypair();
  return { publicKey: pair.publicKey, secretKey: pair.privateKey };
}

/** Seals the secret half of an upload key pair as an owner record of the space. */
export function sealUploadKeyPair(space: SpaceKeys, pair: UploadKeyPair): Promise<string> {
  return sealOwnerRecord(space, 'upload-key', UPLOAD_KEY_ID, pair.secretKey);
}

/**
 * Opens a space's upload key pair. The public half is worked out again from the secret one.
 * Throws DecryptionError if the record doesn't open or doesn't hold a key.
 */
export async function openUploadKeyPair(
  space: SpaceKeys,
  sealedText: string,
): Promise<UploadKeyPair> {
  const sodium = await getSodium();
  const secretKey = await openOwnerRecord(space, 'upload-key', UPLOAD_KEY_ID, sealedText);
  if (secretKey.length !== sodium.crypto_box_SECRETKEYBYTES) throw new DecryptionError();
  return { publicKey: sodium.crypto_scalarmult_base(secretKey), secretKey };
}

/** Bytes crypto_box_seal adds to a records key: an ephemeral public key and a MAC. */
async function sealedKeyBytes(): Promise<number> {
  const sodium = await getSodium();
  return RECORD_KEY_BYTES + sodium.crypto_box_PUBLICKEYBYTES + sodium.crypto_box_MACBYTES;
}

/**
 * Seals a record so only the space's owner can open it, with just the upload key's public
 * half. The whole sealed record fits the same size limit as any other.
 */
export async function sealForUpload(
  publicKey: Uint8Array,
  kind: RecordKind,
  id: string,
  data: Uint8Array,
): Promise<string> {
  const sodium = await getSodium();
  if (publicKey.length !== sodium.crypto_box_PUBLICKEYBYTES) {
    throw new Error('Malformed upload key');
  }
  const keyBytes = await sealedKeyBytes();
  const key = sodium.crypto_kdf_keygen();
  try {
    const sealedKey = sodium.crypto_box_seal(key, publicKey);
    const record = await sealWith(key, kind, id, data, {
      padBlock: PAD_BLOCK,
      maxBytes: STORAGE_SIZES.maxRecord - keyBytes,
    });
    const body = fromBase64Url(record);
    if (!body) throw new Error('This record is too large');
    const sealed = new Uint8Array(sealedKey.length + body.length);
    sealed.set(sealedKey, 0);
    sealed.set(body, sealedKey.length);
    return toBase64Url(sealed);
  } finally {
    sodium.memzero(key);
  }
}

/**
 * Opens a record sealed for upload. Throws DecryptionError for the wrong key pair, any
 * changed byte, or a record that belongs to another id or kind.
 */
export async function openUpload(
  pair: UploadKeyPair,
  kind: RecordKind,
  id: string,
  sealedText: string,
): Promise<Uint8Array> {
  const sodium = await getSodium();
  const sealed = fromBase64Url(sealedText);
  const keyBytes = await sealedKeyBytes();
  if (!sealed || sealed.length <= keyBytes) throw new DecryptionError();
  let key: Uint8Array;
  try {
    key = sodium.crypto_box_seal_open(sealed.subarray(0, keyBytes), pair.publicKey, pair.secretKey);
  } catch {
    throw new DecryptionError();
  }
  try {
    if (key.length !== RECORD_KEY_BYTES) throw new DecryptionError();
    return await openWith(key, kind, id, toBase64Url(sealed.subarray(keyBytes)));
  } finally {
    sodium.memzero(key);
  }
}

/**
 * A new random token that lets one phone add photos to a space, and nothing else. The
 * server keeps only its SHA-256, and the owner can revoke it.
 */
export async function newUploadToken(): Promise<string> {
  const sodium = await getSodium();
  return toBase64Url(sodium.randombytes_buf(STORAGE_SIZES.spaceToken));
}
