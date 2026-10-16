import { constantTimeEqual, fromBase64Url, loginVerifier } from '@twofold/crypto/webcrypto';
import type { Keyring } from '@twofold/types';

import { clearFailures, takeAttempt } from './db';

/** Ten wrong passwords per email per 15 minutes, then 429 until the window passes. */
export const MAX_FAILURES = 10;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;

/**
 * True if the login key matches any of the keyring's verifiers. Every verifier is compared,
 * in constant time, whichever one matches, and the result does not say which slot it was.
 */
export async function matchesAnyVerifier(keyring: Keyring, loginKey: string): Promise<boolean> {
  const key = fromBase64Url(loginKey);
  if (!key) return false;
  const candidate = await loginVerifier(key);
  let matched = false;
  for (const verifier of keyring.verifiers) {
    const stored = fromBase64Url(verifier);
    if (stored && constantTimeEqual(stored, candidate)) matched = true;
  }
  return matched;
}

export type ProofResult = 'ok' | 'wrong' | 'throttled';

/**
 * Checks a login key against an account (or against nothing, for an unknown email), with
 * per-email throttling. Unknown emails count failures too, so they behave the same. Every
 * attempt is counted before the key is checked, so parallel requests can't get past the
 * limit; a right key then clears the count.
 */
export async function checkProof(
  db: D1Database,
  email: string,
  keyring: Keyring | null,
  loginKey: string,
): Promise<ProofResult> {
  const now = Date.now();
  if ((await takeAttempt(db, email, now, now - FAILURE_WINDOW_MS)) > MAX_FAILURES) {
    return 'throttled';
  }
  if (keyring && (await matchesAnyVerifier(keyring, loginKey))) {
    await clearFailures(db, email);
    return 'ok';
  }
  return 'wrong';
}
