import { getSodium } from './sodium';

/** SHA-256 through libsodium: Hermes, the phone apps' JavaScript engine, has no Web Crypto. */
export async function sha256Digest(bytes: Uint8Array): Promise<Uint8Array> {
  return (await getSodium()).crypto_hash_sha256(bytes);
}
