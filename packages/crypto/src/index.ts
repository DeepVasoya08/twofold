/**
 * @twofold/crypto — the only place in Arcafold where cryptography happens.
 *
 * Every primitive is a standard libsodium construction (Argon2id, crypto_kdf, secretbox,
 * BLAKE2b) or Web Crypto SHA-256. See docs/security.md for the key design.
 */
import { getSodium } from './sodium';

export * from './keyring';
export { setPasswordHasher } from './password-hash';
export type { PasswordHasher } from './password-hash';
export { workerHasher } from './hash-worker';
export type { HashWorker } from './hash-worker';
export { decryptLargeFile, encryptLargeFile, setFileCrypto, workerFileCrypto } from './file-worker';
export type { FileCipher, FileCrypto, FileWorker } from './file-worker';
export * from './recovery-key';
export * from './sharing';
export * from './storage';
export { fromBase64Url, toBase64Url } from './webcrypto';

/** Resolves once libsodium's WebAssembly module has loaded and is safe to call. */
export async function ready(): Promise<void> {
  await getSodium();
}
