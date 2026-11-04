import type * as CryptoModule from '@arcafold/crypto';

/** The crypto package, as loaded for this platform. */
export type Crypto = typeof CryptoModule;

let load: () => Promise<Crypto> = () => import('@arcafold/crypto');

/**
 * Sets how core loads the crypto package. The web app adds Web Workers for Argon2id and
 * large files; the default suits a phone, where libsodium runs natively.
 */
export function configureCrypto(next: () => Promise<Crypto>): void {
  load = next;
}

/** Loads the crypto package on first use, so screens that don't need it stay light. */
export function loadCrypto(): Promise<Crypto> {
  return load();
}
