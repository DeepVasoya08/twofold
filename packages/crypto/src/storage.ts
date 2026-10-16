import { STORAGE_SIZES } from '@twofold/types';

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
 * - A space's storage is addressed by its access token, the space id from its key slot.
 */

const KDF_CONTEXT = 'twfspace';
const SUBKEY = { records: 1 } as const;
const CHUNK_BYTES = 64 * 1024;
const PAD_BLOCK = 256;

export type RecordKind = 'photo' | 'album';

export class DecryptionError extends Error {
  constructor(message = 'This data could not be decrypted') {
    super(message);
    this.name = 'DecryptionError';
  }
}

/** The token that addresses a space's storage. The server stores only its SHA-256. */
export function spaceToken(space: SpaceKeys): string {
  if (space.spaceId.length !== STORAGE_SIZES.spaceToken) throw new Error('Malformed space id');
  return toBase64Url(space.spaceId);
}

/** A new random photo or album id. */
export async function newRecordId(): Promise<string> {
  const sodium = await getSodium();
  return toBase64Url(sodium.randombytes_buf(STORAGE_SIZES.recordId));
}

async function recordKey(space: SpaceKeys): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_kdf_derive_from_key(32, SUBKEY.records, KDF_CONTEXT, space.spaceKey);
}

function associatedData(kind: RecordKind, id: string): Uint8Array {
  return new TextEncoder().encode(`twofold:${kind}:${id}`);
}

/** Seals a record's bytes under the space key, bound to its kind and id. */
export async function sealRecord(
  space: SpaceKeys,
  kind: RecordKind,
  id: string,
  data: Uint8Array,
): Promise<string> {
  const sodium = await getSodium();
  const key = await recordKey(space);
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const padded = sodium.pad(data, PAD_BLOCK);
  const box = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    padded,
    associatedData(kind, id),
    null,
    nonce,
    key,
  );
  sodium.memzero(key);
  const sealed = new Uint8Array(nonce.length + box.length);
  sealed.set(nonce, 0);
  sealed.set(box, nonce.length);
  if (sealed.length > STORAGE_SIZES.maxRecord) throw new Error('This record is too large');
  return toBase64Url(sealed);
}

/** Opens a sealed record. Throws DecryptionError if it was tampered with or belongs elsewhere. */
export async function openRecord(
  space: SpaceKeys,
  kind: RecordKind,
  id: string,
  sealedText: string,
): Promise<Uint8Array> {
  const sodium = await getSodium();
  const sealed = fromBase64Url(sealedText);
  const nonceBytes = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
  if (!sealed || sealed.length < nonceBytes + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES) {
    throw new DecryptionError();
  }
  const key = await recordKey(space);
  try {
    const padded = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      sealed.subarray(nonceBytes),
      associatedData(kind, id),
      sealed.subarray(0, nonceBytes),
      key,
    );
    return sodium.unpad(padded, PAD_BLOCK);
  } catch {
    throw new DecryptionError();
  } finally {
    sodium.memzero(key);
  }
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
