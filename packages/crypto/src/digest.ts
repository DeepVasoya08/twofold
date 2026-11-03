/** SHA-256 through Web Crypto (browsers, Workers, Node). The phone apps use digest.native.ts. */
export async function sha256Digest(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
}
