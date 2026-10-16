/** Response body of the API health check (`GET /health`). */
export interface HealthResponse {
  status: 'ok';
}

/** Error body every failing API route returns. The message is safe to show to the user. */
export interface ErrorResponse {
  error: string;
}

/**
 * Byte sizes of the key material the browser sends. The API checks lengths against these;
 * packages/crypto produces values of exactly these sizes. Binary values travel as unpadded
 * base64url.
 */
export const KEY_SIZES = {
  salt: 16,
  /** A sealed key slot: nonce (24) + MAC (16) + space key (32) + space id (16). */
  slot: 88,
  /** A login key, and the SHA-256 verifier the server keeps of it. */
  loginKey: 32,
  verifier: 32,
} as const;

/**
 * Every account has exactly this many key slots, in this order: main password, recovery
 * key, private password. A slot that is not in use holds random bytes, which look the same
 * as a sealed slot, so nobody can tell from the keyring whether a private space exists.
 */
export const SLOT_COUNT = 3;

export type Slots = [string, string, string];

/** Argon2id cost parameters, kept with the account so they can be raised later. */
export interface KdfParams {
  opsLimit: number;
  memLimit: number;
}

/** Everything the server keeps about an account's keys. None of it is readable without a password. */
export interface Keyring {
  salt: string;
  kdf: KdfParams;
  slots: Slots;
  /** SHA-256 of each slot's login key, so the server can check a login without learning keys. */
  verifiers: Slots;
}

/** The account as the signed-in browser sees it. */
export interface AccountResponse {
  email: string;
  name: string;
  /** Bumped on every keyring change; updates must name the version they started from. */
  version: number;
  keyring: Keyring;
}

export interface SignUpRequest {
  email: string;
  name: string;
  keyring: Keyring;
}

export interface PreLoginRequest {
  email: string;
}

/** What the browser needs to turn a password into a login key. */
export interface PreLoginResponse {
  salt: string;
  kdf: KdfParams;
}

export interface LoginRequest {
  email: string;
  /** Login key derived from the main password, the private password, or the recovery key. */
  loginKey: string;
}

/** Replaces the whole keyring. Sending all slots every time hides which one changed. */
export interface UpdateKeyringRequest {
  /** Proves the caller knows a password (or the recovery key), not just the session cookie. */
  loginKey: string;
  version: number;
  keyring: Keyring;
}

export interface DeleteAccountRequest {
  loginKey: string;
}
