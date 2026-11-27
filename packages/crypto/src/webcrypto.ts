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

/** Digits in an email code. */
export const EMAIL_CODE_DIGITS = 6;

/** The shortest server secret accepted for keying email codes (32 bytes of base64 or more). */
export const EMAIL_SECRET_MIN_LENGTH = 32;

/**
 * A new email code: six digits, each from a uniformly random byte (bytes of 250 and above
 * are thrown away, so no digit is more likely than another).
 */
export function newEmailCode(): string {
  let code = '';
  while (code.length < EMAIL_CODE_DIGITS) {
    for (const byte of randomBytes(EMAIL_CODE_DIGITS)) {
      if (byte < 250 && code.length < EMAIL_CODE_DIGITS) code += String(byte % 10);
    }
  }
  return code;
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  if (secret.length < EMAIL_SECRET_MIN_LENGTH) throw new Error('The email secret is too short.');
  return hmacSha256Raw(secret, message);
}

async function hmacSha256Raw(secret: string, message: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/**
 * The name a pending email code is stored under: an HMAC of what it is for, keyed with the
 * server's secret, so the table holds no account id or address in readable form.
 */
export async function emailCodeScope(
  secret: string,
  purpose: string,
  subject: string,
): Promise<string> {
  return toBase64Url(await hmacSha256(secret, `arcafold email scope\n${purpose}\n${subject}`));
}

/**
 * What is stored for a code: an HMAC of the code bound to its scope and to the address it
 * was sent to. Six digits are easy to guess from a plain hash, but not without the secret,
 * so a copy of the database alone gives nothing away.
 */
export async function emailCodeTag(
  secret: string,
  scope: string,
  address: string,
  code: string,
): Promise<string> {
  return toBase64Url(
    await hmacSha256(secret, `arcafold email code\n${scope}\n${address}\n${code}`),
  );
}

/** Whether a typed code matches a stored tag, compared in constant time. */
export async function emailCodeMatches(
  secret: string,
  scope: string,
  address: string,
  code: string,
  storedTag: string,
): Promise<boolean> {
  const stored = fromBase64Url(storedTag);
  const candidate = fromBase64Url(await emailCodeTag(secret, scope, address, code));
  return stored !== null && candidate !== null && constantTimeEqual(stored, candidate);
}

/**
 * A salt for an email with no account, so the sign-in's first step looks the same whether
 * or not the account exists: always the same for one email, and unguessable without the
 * server's secret.
 */
export async function decoySalt(secret: string, email: string, length: number): Promise<string> {
  const mac = await hmacSha256(secret, `arcafold decoy salt\n${email}`);
  return toBase64Url(mac.slice(0, length));
}

/** The shortest webhook secret accepted for checking a payment provider's signatures. */
export const WEBHOOK_SECRET_MIN_LENGTH = 16;

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Whether `signature` is the lowercase hex HMAC-SHA256 of `body` under `secret`, as payment
 * providers such as Razorpay sign their notifications. `body` must be the raw text exactly as
 * received: parsing and re-encoding JSON would change it. Compared in constant time.
 */
export async function webhookSignatureMatches(
  secret: string,
  body: string,
  signature: string,
): Promise<boolean> {
  if (secret.length < WEBHOOK_SECRET_MIN_LENGTH) return false;
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = new TextEncoder().encode(toHex(await hmacSha256Raw(secret, body)));
  return constantTimeEqual(expected, new TextEncoder().encode(signature));
}

/** The signature `webhookSignatureMatches` accepts; for tests and local replays only. */
export async function webhookSignature(secret: string, body: string): Promise<string> {
  return toHex(await hmacSha256Raw(secret, body));
}
