/**
 * Hashing and encoding helpers built on Web Crypto only, so the API Worker can use them
 * without loading libsodium's WebAssembly. Exposed as `@arcafold/crypto/webcrypto`.
 */
import { sha256Digest } from './digest';

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes unpadded base64url. Returns null for anything that is not strict base64url. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const padded =
    text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // Reject non-canonical encodings (stray bits in the last character).
  return toBase64Url(bytes) === text ? bytes : null;
}

export function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return sha256Digest(bytes);
}

/**
 * The verifier the server stores for a login key. Login keys are 32 bytes straight out of
 * Argon2id (or a 128-bit recovery key), so a fast hash is enough here: guessing a password
 * from a verifier still costs one Argon2id run per guess.
 */
export function loginVerifier(loginKey: Uint8Array): Promise<Uint8Array> {
  return sha256(loginKey);
}

/** Compares two byte strings in time that depends only on their lengths. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** A new random session token (256 bits), base64url. */
export function newSessionToken(): string {
  return toBase64Url(randomBytes(32));
}

/** What the server stores for a session token, so a database leak does not leak sessions. */
export async function sessionTokenHash(token: string): Promise<string> {
  return toBase64Url(await sha256(new TextEncoder().encode(token)));
}
