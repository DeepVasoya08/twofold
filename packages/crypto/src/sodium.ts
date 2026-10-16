import sodium from 'libsodium-wrappers-sumo';

/** libsodium, once its WebAssembly module has loaded. Every crypto call goes through this. */
export async function getSodium(): Promise<typeof sodium> {
  await sodium.ready;
  return sodium;
}
