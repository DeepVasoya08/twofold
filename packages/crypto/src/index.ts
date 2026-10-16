/**
 * @twofold/crypto — the only place in Twofold where cryptography happens.
 *
 * Every primitive must be a standard libsodium construction. Nothing is
 * implemented yet; see docs/security.md before adding anything here.
 */
import sodium from 'libsodium-wrappers';

/** Resolves once libsodium's WebAssembly module has loaded and is safe to call. */
export async function ready(): Promise<void> {
  await sodium.ready;
}
