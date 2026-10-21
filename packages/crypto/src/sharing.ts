import { KEY_SIZES, SHARE_SIZES, STORAGE_SIZES } from '@twofold/types';
import type { KdfParams } from '@twofold/types';

import { DEFAULT_KDF } from './keyring';
import type { SpaceKeys } from './keyring';
import { hashPassword } from './password-hash';
import { getSodium } from './sodium';
import { DecryptionError, openOwnerRecord, sealOwnerRecord } from './storage';
import { fromBase64Url, toBase64Url } from './webcrypto';
import { WORDLIST } from './wordlist';

/**
 * Invites: how one account hands access to a space to another, through a server it doesn't
 * trust.
 *
 * Both sides make a crypto_box key pair and exchange public keys through the server. The
 * inviter first publishes only a commitment (BLAKE2b) to its key, and reveals the key after
 * the joiner has sent theirs, so a server in the middle has to pick its fake keys blind.
 * Both sides then show a safety phrase derived from both public keys (with Argon2id, so it
 * is slow to search); if the phrases match, nobody swapped keys. Only after the inviter confirms that does it send the access, sealed
 * with crypto_box to the joiner's key.
 *
 * Neither side has to stay online: each keeps its secret key for the invite in an owner-only
 * record of the space it invites from or joins into (`sealPendingInvite`), so the next visit,
 * on any of its devices, can take the next step.
 */

/** Invite codes look like TWO-7KQ4-M9XD: 8 characters from 32, so 40 random bits. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_CHARS = 8;
const PHRASE_WORDS = 4;
const PHRASE_CONTEXT = 'twofold:safety-phrase:v2';
const PHRASE_SALT_CONTEXT = 'twofold:safety-phrase-salt:v2';

/**
 * What one safety phrase costs: Argon2id at the login cost (64 MiB, 3 passes). Each side pays
 * it once per invite; a server searching for a joiner key whose words match would pay it
 * about 2^44 times.
 */
export const PHRASE_KDF: KdfParams = DEFAULT_KDF;
const COMMIT_CONTEXT = 'twofold:invite-commit:v1';

/**
 * What a sealed message is for, so one can't be replayed as another: the joiner's name
 * (`hello`), the inviter's name (`intro`), and the access (`grant`).
 */
export type PeerMessage = 'hello' | 'intro' | 'grant';

/** One side's key pair for a single invite. Thrown away when the invite ends. */
export interface InviteKeys {
  publicKey: string;
  secretKey: Uint8Array;
}

/** A new invite code, formatted TWO-XXXX-XXXX. */
export async function newInviteCode(): Promise<string> {
  const sodium = await getSodium();
  let chars = '';
  for (let i = 0; i < CODE_CHARS; i++) {
    chars += CODE_ALPHABET[sodium.randombytes_uniform(CODE_ALPHABET.length)] ?? '';
  }
  return `TWO-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export async function newInviteKeys(): Promise<InviteKeys> {
  const sodium = await getSodium();
  const pair = sodium.crypto_box_keypair();
  return { publicKey: toBase64Url(pair.publicKey), secretKey: pair.privateKey };
}

function publicKeyBytes(text: string, bytes: number): Uint8Array {
  const key = fromBase64Url(text);
  if (key?.length !== bytes) throw new DecryptionError('Malformed public key');
  return key;
}

async function commitmentBytes(publicKey: string): Promise<Uint8Array> {
  const sodium = await getSodium();
  const key = publicKeyBytes(publicKey, sodium.crypto_box_PUBLICKEYBYTES);
  return sodium.crypto_generichash(32, key, new TextEncoder().encode(COMMIT_CONTEXT));
}

/** The inviter's commitment to its public key, published before the key itself. */
export async function inviteCommitment(publicKey: string): Promise<string> {
  return toBase64Url(await commitmentBytes(publicKey));
}

/** True if `publicKey` is the key the inviter committed to. */
export async function checkCommitment(commitment: string, publicKey: string): Promise<boolean> {
  const sodium = await getSodium();
  const expected = fromBase64Url(commitment);
  if (expected?.length !== 32) return false;
  let actual: Uint8Array;
  try {
    actual = await commitmentBytes(publicKey);
  } catch {
    return false;
  }
  return sodium.memcmp(expected, actual);
}

/** Phrases already worked out on this device, so checking an invite again is free. */
const phraseCache = new Map<string, string[]>();
const PHRASE_CACHE_MAX = 32;

/** Turns the first 44 bits of `bytes` into four BIP-39 words. */
function wordsFrom(bytes: Uint8Array): string[] {
  const words: string[] = [];
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    if (bits >= 11) {
      bits -= 11;
      words.push(WORDLIST[(value >> bits) & 0x7ff] ?? '');
      value &= (1 << bits) - 1;
      if (words.length === PHRASE_WORDS) break;
    }
  }
  return words;
}

/**
 * Four words both people see once keys are exchanged. They match only if each side got the
 * other's real public key. 44 bits: with the commitment, a server in the middle gets one
 * blind guess per invite.
 *
 * The words come from Argon2id (`crypto_pwhash` at PHRASE_KDF, the login cost) over the
 * transcript: a keyed BLAKE2b of both public keys, in order. The 16-byte salt is fixed by
 * the same transcript (a BLAKE2b of it under its own label), so both sides get the same
 * words and nothing else is needed. This doesn't change what a blind guess wins; it makes
 * searching expensive: a server that somehow learned the inviter's key before choosing a
 * joiner key would need about 2^44 Argon2id runs to find one whose words match. It runs
 * through the configured password hasher, so in the web app it runs in a Web Worker.
 */
export async function safetyPhrase(inviterKey: string, joinerKey: string): Promise<string[]> {
  const sodium = await getSodium();
  const size = sodium.crypto_box_PUBLICKEYBYTES;
  const input = new Uint8Array(size * 2);
  input.set(publicKeyBytes(inviterKey, size), 0);
  input.set(publicKeyBytes(joinerKey, size), size);
  const cacheKey = `${inviterKey}.${joinerKey}`;
  const cached = phraseCache.get(cacheKey);
  if (cached) return [...cached];
  const encoder = new TextEncoder();
  const transcript = sodium.crypto_generichash(32, input, encoder.encode(PHRASE_CONTEXT));
  const salt = sodium.crypto_generichash(
    KEY_SIZES.salt,
    transcript,
    encoder.encode(PHRASE_SALT_CONTEXT),
  );
  const derived = await hashPassword({
    password: toBase64Url(transcript),
    salt,
    kdf: PHRASE_KDF,
  });
  const words = wordsFrom(derived);
  sodium.memzero(derived);
  if (phraseCache.size >= PHRASE_CACHE_MAX) {
    const oldest = phraseCache.keys().next().value;
    if (oldest !== undefined) phraseCache.delete(oldest);
  }
  phraseCache.set(cacheKey, words);
  return [...words];
}

function labelled(purpose: PeerMessage): Uint8Array {
  return new TextEncoder().encode(`twofold:${purpose}:v1\n`);
}

/** Seals a message for the other side of an invite (crypto_box, sender authenticated). */
export async function sealForPeer(
  purpose: PeerMessage,
  data: Uint8Array,
  peerKey: string,
  mine: InviteKeys,
): Promise<string> {
  const sodium = await getSodium();
  const label = labelled(purpose);
  const plain = new Uint8Array(label.length + data.length);
  plain.set(label, 0);
  plain.set(data, label.length);
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const box = sodium.crypto_box_easy(
    plain,
    nonce,
    publicKeyBytes(peerKey, sodium.crypto_box_PUBLICKEYBYTES),
    mine.secretKey,
  );
  sodium.memzero(plain);
  const sealed = new Uint8Array(nonce.length + box.length);
  sealed.set(nonce, 0);
  sealed.set(box, nonce.length);
  return toBase64Url(sealed);
}

/**
 * Opens a message sealed by the other side. Throws DecryptionError if it was tampered with,
 * came from another key, or was sealed for a different purpose.
 */
export async function openFromPeer(
  purpose: PeerMessage,
  sealedText: string,
  peerKey: string,
  mine: InviteKeys,
): Promise<Uint8Array> {
  const sodium = await getSodium();
  const sealed = fromBase64Url(sealedText);
  const nonceBytes = sodium.crypto_box_NONCEBYTES;
  if (!sealed || sealed.length < nonceBytes + sodium.crypto_box_MACBYTES) {
    throw new DecryptionError();
  }
  let plain: Uint8Array;
  try {
    plain = sodium.crypto_box_open_easy(
      sealed.subarray(nonceBytes),
      sealed.subarray(0, nonceBytes),
      publicKeyBytes(peerKey, sodium.crypto_box_PUBLICKEYBYTES),
      mine.secretKey,
    );
  } catch {
    throw new DecryptionError();
  }
  const label = labelled(purpose);
  const head = plain.subarray(0, label.length);
  if (head.length !== label.length || !sodium.memcmp(head, label)) throw new DecryptionError();
  return plain.slice(label.length);
}

/** Forgets an invite's secret key. */
export async function dropInviteKeys(keys: InviteKeys): Promise<void> {
  const sodium = await getSodium();
  sodium.memzero(keys.secretKey);
}

/**
 * A new invite link token: 128 random bits, so it can't be guessed. It only names the invite
 * (the server keeps its SHA-256, like the code); it carries no key material.
 */
export async function newInviteLink(): Promise<string> {
  const sodium = await getSodium();
  return toBase64Url(sodium.randombytes_buf(SHARE_SIZES.link));
}

/**
 * Seals one side's state of an invite as an owner-only record of `space`, so the invite can
 * be finished later, from any device that opens that space: the invite's secret key, then
 * `details` (what the invite is for, and how to reach it). Members of the space never get
 * the subkey these records are sealed under.
 */
export async function sealPendingInvite(
  space: SpaceKeys,
  id: string,
  keys: InviteKeys,
  details: Uint8Array,
): Promise<string> {
  const sodium = await getSodium();
  if (keys.secretKey.length !== sodium.crypto_box_SECRETKEYBYTES) {
    throw new Error('Malformed invite key');
  }
  const plain = new Uint8Array(keys.secretKey.length + details.length);
  plain.set(keys.secretKey, 0);
  plain.set(details, keys.secretKey.length);
  try {
    return await sealOwnerRecord(space, 'invite', id, plain);
  } finally {
    sodium.memzero(plain);
  }
}

/**
 * Opens a record `sealPendingInvite` made: the invite's key pair (the public key is derived
 * again from the secret one) and its details. Throws DecryptionError if the record was
 * tampered with, belongs to another record or space, or is malformed.
 */
export async function openPendingInvite(
  space: SpaceKeys,
  id: string,
  sealed: string,
): Promise<{ keys: InviteKeys; details: Uint8Array }> {
  const sodium = await getSodium();
  const plain = await openOwnerRecord(space, 'invite', id, sealed);
  const keyBytes = sodium.crypto_box_SECRETKEYBYTES;
  if (plain.length < keyBytes) {
    sodium.memzero(plain);
    throw new DecryptionError();
  }
  const secretKey = plain.slice(0, keyBytes);
  const details = plain.slice(keyBytes);
  sodium.memzero(plain);
  const publicKey = toBase64Url(sodium.crypto_scalarmult_base(secretKey));
  return { keys: { publicKey, secretKey }, details };
}

/** A new random token a member uses to reach a shared space. The owner can revoke it. */
export async function newShareToken(): Promise<string> {
  const sodium = await getSodium();
  return toBase64Url(sodium.randombytes_buf(STORAGE_SIZES.spaceToken));
}
