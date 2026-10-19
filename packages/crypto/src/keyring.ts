import { KEY_SIZES, SLOT_COUNT } from '@twofold/types';
import type { KdfParams, Keyring, Slots } from '@twofold/types';

import { hashPassword } from './password-hash';
import { getSodium } from './sodium';
import { fromBase64Url, loginVerifier, toBase64Url } from './webcrypto';

/**
 * Key slots.
 *
 * Every account has one salt and exactly three slots: main password, recovery key, private
 * password. A password (via Argon2id) or the recovery key yields a wrap key and a login
 * key. The wrap key opens one slot with crypto_secretbox; the slot holds a space's random
 * key and id. The login key's SHA-256 is the slot's verifier, which the server checks at
 * login. Unused slots and verifiers are random bytes, indistinguishable from real ones.
 */

export const SLOT = { main: 0, recovery: 1, private: 2 } as const;
export type SlotIndex = (typeof SLOT)[keyof typeof SLOT];

/** Argon2id at 64 MiB and 3 passes. Raising these later only needs a new keyring. */
export const DEFAULT_KDF: KdfParams = { opsLimit: 3, memLimit: 64 * 1024 * 1024 };

/** The weakest parameters the client accepts, so a hostile server cannot downgrade them. */
export const MIN_KDF: KdfParams = DEFAULT_KDF;
export const MAX_KDF: KdfParams = { opsLimit: 10, memLimit: 1024 * 1024 * 1024 };

const SPACE_KEY_BYTES = 32;
const SPACE_ID_BYTES = 16;
const KDF_CONTEXT = 'twofold1';
const SUBKEY = { wrap: 1, login: 2 } as const;

/** The keys of one space: what a slot protects. */
export interface SpaceKeys {
  spaceKey: Uint8Array;
  spaceId: Uint8Array;
}

/** What a password or recovery key turns into. */
export interface SlotSecret {
  wrapKey: Uint8Array;
  loginKey: Uint8Array;
}

/** A successfully opened slot. */
export interface OpenedSlot {
  slot: SlotIndex;
  space: SpaceKeys;
  loginKey: Uint8Array;
}

export class InvalidKeyringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidKeyringError';
  }
}

/** True if the parameters are between MIN_KDF and MAX_KDF. */
export function kdfInRange(kdf: KdfParams): boolean {
  return (
    Number.isInteger(kdf.opsLimit) &&
    Number.isInteger(kdf.memLimit) &&
    kdf.opsLimit >= MIN_KDF.opsLimit &&
    kdf.memLimit >= MIN_KDF.memLimit &&
    kdf.opsLimit <= MAX_KDF.opsLimit &&
    kdf.memLimit <= MAX_KDF.memLimit
  );
}

function checkKdf(kdf: KdfParams): void {
  if (!kdfInRange(kdf)) throw new InvalidKeyringError('Key derivation parameters are out of range');
}

function decode(text: string, size: number, what: string): Uint8Array {
  const bytes = fromBase64Url(text);
  if (bytes?.length !== size) throw new InvalidKeyringError(`Malformed ${what}`);
  return bytes;
}

async function secretFromMaster(master: Uint8Array): Promise<SlotSecret> {
  const sodium = await getSodium();
  const secret = {
    wrapKey: sodium.crypto_kdf_derive_from_key(32, SUBKEY.wrap, KDF_CONTEXT, master),
    loginKey: sodium.crypto_kdf_derive_from_key(32, SUBKEY.login, KDF_CONTEXT, master),
  };
  sodium.memzero(master);
  return secret;
}

/**
 * Runs Argon2id on a password. This is the slow step (well under a second on most devices);
 * the web app runs it in a Web Worker (see setPasswordHasher).
 */
export async function deriveFromPassword(
  password: string,
  saltText: string,
  kdf: KdfParams,
): Promise<SlotSecret> {
  checkKdf(kdf);
  const salt = decode(saltText, KEY_SIZES.salt, 'salt');
  const master = await hashPassword({ password: password.normalize('NFC'), salt, kdf });
  return secretFromMaster(master);
}

/** The recovery key is already 128 random bits, so a keyed BLAKE2b is enough to stretch it. */
export async function deriveFromRecoveryKey(
  recoveryKey: Uint8Array,
  saltText: string,
): Promise<SlotSecret> {
  const salt = decode(saltText, KEY_SIZES.salt, 'salt');
  const sodium = await getSodium();
  return secretFromMaster(sodium.crypto_generichash(32, recoveryKey, salt));
}

export async function newSpace(): Promise<SpaceKeys> {
  const sodium = await getSodium();
  return {
    spaceKey: sodium.randombytes_buf(SPACE_KEY_BYTES),
    spaceId: sodium.randombytes_buf(SPACE_ID_BYTES),
  };
}

async function sealSlot(space: SpaceKeys, wrapKey: Uint8Array): Promise<string> {
  const sodium = await getSodium();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const payload = new Uint8Array(SPACE_KEY_BYTES + SPACE_ID_BYTES);
  payload.set(space.spaceKey, 0);
  payload.set(space.spaceId, SPACE_KEY_BYTES);
  const sealed = new Uint8Array(KEY_SIZES.slot);
  sealed.set(nonce, 0);
  sealed.set(sodium.crypto_secretbox_easy(payload, nonce, wrapKey), nonce.length);
  sodium.memzero(payload);
  return toBase64Url(sealed);
}

async function openSlot(slotText: string, wrapKey: Uint8Array): Promise<SpaceKeys | null> {
  const sodium = await getSodium();
  const sealed = decode(slotText, KEY_SIZES.slot, 'slot');
  const nonce = sealed.subarray(0, sodium.crypto_secretbox_NONCEBYTES);
  const box = sealed.subarray(sodium.crypto_secretbox_NONCEBYTES);
  try {
    const payload = sodium.crypto_secretbox_open_easy(box, nonce, wrapKey);
    return {
      spaceKey: payload.slice(0, SPACE_KEY_BYTES),
      spaceId: payload.slice(SPACE_KEY_BYTES),
    };
  } catch {
    return null;
  }
}

async function randomText(size: number): Promise<string> {
  const sodium = await getSodium();
  return toBase64Url(sodium.randombytes_buf(size));
}

/** Checks shapes and sizes. Throws InvalidKeyringError if anything is off. */
export function validateKeyring(keyring: Keyring): void {
  checkKdf(keyring.kdf);
  decode(keyring.salt, KEY_SIZES.salt, 'salt');
  // The types say three, but a keyring from the network can be any shape.
  const slots: readonly string[] = keyring.slots;
  const verifiers: readonly string[] = keyring.verifiers;
  if (slots.length !== SLOT_COUNT || verifiers.length !== SLOT_COUNT) {
    throw new InvalidKeyringError('Wrong number of slots');
  }
  for (const slot of slots) decode(slot, KEY_SIZES.slot, 'slot');
  for (const verifier of verifiers) decode(verifier, KEY_SIZES.verifier, 'verifier');
}

export interface NewAccountKeys {
  keyring: Keyring;
  /** The opened main slot, so the new account starts unlocked. */
  main: OpenedSlot;
}

/** Builds a new account's keyring: main and recovery slots open the same space; the private slot is random. */
export async function createKeyring(
  password: string,
  recoveryKey: Uint8Array,
  kdf: KdfParams = DEFAULT_KDF,
): Promise<NewAccountKeys> {
  const sodium = await getSodium();
  const salt = toBase64Url(sodium.randombytes_buf(KEY_SIZES.salt));
  const passwordSecret = await deriveFromPassword(password, salt, kdf);
  const recoverySecret = await deriveFromRecoveryKey(recoveryKey, salt);
  const main = await newSpace();
  const keyring: Keyring = {
    salt,
    kdf,
    slots: [
      await sealSlot(main, passwordSecret.wrapKey),
      await sealSlot(main, recoverySecret.wrapKey),
      await randomText(KEY_SIZES.slot),
    ],
    verifiers: [
      toBase64Url(await loginVerifier(passwordSecret.loginKey)),
      toBase64Url(await loginVerifier(recoverySecret.loginKey)),
      await randomText(KEY_SIZES.verifier),
    ],
  };
  return { keyring, main: { slot: SLOT.main, space: main, loginKey: passwordSecret.loginKey } };
}

/**
 * Tries a secret against every slot and returns the one it opens, or null. All slots are
 * always tried, so how long this takes says nothing about which slot matched.
 */
export async function openKeyring(
  keyring: Keyring,
  secret: SlotSecret,
): Promise<OpenedSlot | null> {
  validateKeyring(keyring);
  let found: OpenedSlot | null = null;
  for (const [index, slot] of keyring.slots.entries()) {
    const space = await openSlot(slot, secret.wrapKey);
    if (space && !found) found = { slot: index as SlotIndex, space, loginKey: secret.loginKey };
  }
  return found;
}

/** Opens a keyring with a password (main or private). */
export async function unlockWithPassword(
  keyring: Keyring,
  password: string,
): Promise<OpenedSlot | null> {
  validateKeyring(keyring);
  return openKeyring(keyring, await deriveFromPassword(password, keyring.salt, keyring.kdf));
}

/** Opens a keyring with the recovery key. Only the recovery slot can match. */
export async function unlockWithRecoveryKey(
  keyring: Keyring,
  recoveryKey: Uint8Array,
): Promise<OpenedSlot | null> {
  validateKeyring(keyring);
  return openKeyring(keyring, await deriveFromRecoveryKey(recoveryKey, keyring.salt));
}

/**
 * Returns a copy of the keyring with one slot (and its verifier) replaced. Every other slot
 * is copied byte for byte, so the main library can rewrite its own slots without knowing
 * whether the private slot is in use.
 */
export async function replaceSlot(
  keyring: Keyring,
  index: SlotIndex,
  space: SpaceKeys,
  secret: SlotSecret,
): Promise<Keyring> {
  validateKeyring(keyring);
  const slots: Slots = [...keyring.slots];
  const verifiers: Slots = [...keyring.verifiers];
  slots[index] = await sealSlot(space, secret.wrapKey);
  verifiers[index] = toBase64Url(await loginVerifier(secret.loginKey));
  return { ...keyring, slots, verifiers };
}
