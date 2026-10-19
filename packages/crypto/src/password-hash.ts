import type { KdfParams } from '@twofold/types';

import { getSodium } from './sodium';

/** Argon2id's output: the master secret that a password's slot keys are derived from. */
export const MASTER_BYTES = 32;

/** One Argon2id run. The password is already NFC-normalized and the parameters checked. */
export interface PasswordHashRequest {
  password: string;
  salt: Uint8Array;
  kdf: KdfParams;
}

/** Runs Argon2id somewhere (this thread or a Web Worker) and resolves to the master secret. */
export type PasswordHasher = (request: PasswordHashRequest) => Promise<Uint8Array>;

/** Argon2id on this thread. Every hasher ends up here, in this thread or in a worker. */
export async function argon2id(request: PasswordHashRequest): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_pwhash(
    MASTER_BYTES,
    request.password,
    request.salt,
    request.kdf.opsLimit,
    request.kdf.memLimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

let hasher: PasswordHasher = argon2id;

/**
 * Chooses where Argon2id runs. The web app passes a Web Worker hasher (see hash-worker.ts) so
 * the page stays responsive; null goes back to this thread. The result is the same either way.
 */
export function setPasswordHasher(next: PasswordHasher | null): void {
  hasher = next ?? argon2id;
}

/** Runs Argon2id with the chosen hasher. */
export async function hashPassword(request: PasswordHashRequest): Promise<Uint8Array> {
  const master = await hasher(request);
  if (master.length !== MASTER_BYTES) throw new Error('Password hashing failed');
  return master;
}
