import { STORAGE_SIZES } from '@twofold/types';

import { getSodium } from './sodium';
import { DecryptionError } from './storage';
import { fromBase64Url, toBase64Url } from './webcrypto';
import { WORDLIST } from './wordlist';

/**
 * Invites: how one account hands access to a space to another, through a server it doesn't
 * trust.
 *
 * Both sides make a crypto_box key pair and exchange public keys through the server. The
 * inviter first publishes only a commitment (BLAKE2b) to its key, and reveals the key after
 * the joiner has sent theirs, so a server in the middle has to pick its fake keys blind.
 * Both sides then show a safety phrase hashed from both public keys; if the phrases match,
 * nobody swapped keys. Only after the inviter confirms that does it send the access, sealed
 * with crypto_box to the joiner's key.
 */

/** Invite codes look like TWO-7KQ4-M9XD: 8 characters from 32, so 40 random bits. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_CHARS = 8;
const PHRASE_WORDS = 4;
const PHRASE_CONTEXT = 'twofold:safety-phrase:v1';
const COMMIT_CONTEXT = 'twofold:invite-commit:v1';

/** What a sealed message is for, so one can't be replayed as the other. */
export type PeerMessage = 'hello' | 'grant';

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

/**
 * Four words both people see once keys are exchanged. They match only if each side got the
 * other's real public key. 44 bits: with the commitment, a server in the middle gets one
 * blind guess per invite.
 */
export async function safetyPhrase(inviterKey: string, joinerKey: string): Promise<string[]> {
  const sodium = await getSodium();
  const size = sodium.crypto_box_PUBLICKEYBYTES;
  const input = new Uint8Array(size * 2);
  input.set(publicKeyBytes(inviterKey, size), 0);
  input.set(publicKeyBytes(joinerKey, size), size);
  const hash = sodium.crypto_generichash(32, input, new TextEncoder().encode(PHRASE_CONTEXT));
  const words: string[] = [];
  let bits = 0;
  let value = 0;
  for (const byte of hash) {
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

/** A new random token a member uses to reach a shared space. The owner can revoke it. */
export async function newShareToken(): Promise<string> {
  const sodium = await getSodium();
  return toBase64Url(sodium.randombytes_buf(STORAGE_SIZES.spaceToken));
}
