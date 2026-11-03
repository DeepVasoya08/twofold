import sodium from 'libsodium-wrappers-sumo';

import type { Sodium } from './sodium-api';

/**
 * libsodium, once its WebAssembly module has loaded. Every crypto call goes through this.
 * The phone apps resolve `./sodium` to sodium.native.ts instead (Metro picks `.native.ts`).
 */
export async function getSodium(): Promise<Sodium> {
  await sodium.ready;
  return sodium;
}
