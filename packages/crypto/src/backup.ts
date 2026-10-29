import { getSodium } from './sodium';
import { DecryptionError, decryptFile, encryptFile, newFileKey } from './storage';
import { fromBase64Url, toBase64Url } from './webcrypto';

/**
 * Database backups, sealed so that only the holder of an offline key can open them.
 *
 * The backup job knows only a public key. Each backup gets a random file key, which is
 * sealed to that public key with crypto_box_seal; the backup itself is encrypted with the
 * file key using the same secretstream construction as photo files. Opening one needs the
 * secret key, which never touches CI or Cloudflare.
 *
 * Layout: "TFBK", a version byte, the sealed file key, then the secretstream file.
 */

const MAGIC = new TextEncoder().encode('TFBK');
const VERSION = 1;
const KEY_BYTES = 32;
/** crypto_box_seal adds an ephemeral public key (32) and a MAC (16) to the file key. */
const SEALED_KEY_BYTES = KEY_BYTES + 32 + 16;
const PREFIX_BYTES = MAGIC.length + 1 + SEALED_KEY_BYTES;

/** A backup key pair, base64url. The public key goes to CI; the secret key stays offline. */
export interface BackupKeyPair {
  publicKey: string;
  secretKey: string;
}

export async function newBackupKeyPair(): Promise<BackupKeyPair> {
  const sodium = await getSodium();
  const pair = sodium.crypto_box_keypair();
  return { publicKey: toBase64Url(pair.publicKey), secretKey: toBase64Url(pair.privateKey) };
}

function decodeKey(text: string, name: string): Uint8Array {
  const key = fromBase64Url(text.trim());
  if (key?.length !== KEY_BYTES) throw new TypeError(`That ${name} isn't a backup key`);
  return key;
}

/** Encrypts a backup so only the holder of the matching secret key can open it. */
export async function sealBackup(publicKey: string, data: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  const recipient = decodeKey(publicKey, 'public key');
  const fileKey = await newFileKey();
  const sealedKey = sodium.crypto_box_seal(fileKey, recipient);
  const body = await encryptFile(fileKey, data);
  const out = new Uint8Array(PREFIX_BYTES + body.length);
  out.set(MAGIC, 0);
  out[MAGIC.length] = VERSION;
  out.set(sealedKey, MAGIC.length + 1);
  out.set(body, PREFIX_BYTES);
  return out;
}

/**
 * Opens a backup made by sealBackup. Throws DecryptionError for a wrong key, a file that
 * isn't a backup, or any changed, missing or extra byte.
 */
export async function openBackup(secretKey: string, sealed: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  const secret = decodeKey(secretKey, 'secret key');
  if (
    sealed.length < PREFIX_BYTES ||
    !MAGIC.every((byte, index) => sealed[index] === byte) ||
    sealed[MAGIC.length] !== VERSION
  ) {
    throw new DecryptionError();
  }
  const publicKey = sodium.crypto_scalarmult_base(secret);
  let fileKey: Uint8Array;
  try {
    fileKey = sodium.crypto_box_seal_open(
      sealed.subarray(MAGIC.length + 1, PREFIX_BYTES),
      publicKey,
      secret,
    );
  } catch {
    throw new DecryptionError();
  }
  return decryptFile(fileKey, sealed.subarray(PREFIX_BYTES));
}
