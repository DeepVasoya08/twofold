import type { Context } from 'hono';

import {
  constantTimeEqual,
  fromBase64Url,
  loginVerifier,
  sha256,
  toBase64Url,
} from '@twofold/crypto/webcrypto';
import type { Keyring } from '@twofold/types';

import { attemptCount, attemptQuery, clearFailures, finishedWindowsQuery } from './db';

/**
 * Ten wrong passwords per email from one internet address per 15 minutes, then 429 until
 * the window passes. Someone else's address doesn't count against yours, so nobody can lock
 * you out by guessing from theirs.
 */
export const MAX_FAILURES = 10;
/**
 * A ceiling per email across every address, so guessing from many addresses at once still
 * stops. Reaching it takes 20 addresses, which a lockout attempt from one machine can't.
 */
export const MAX_EMAIL_FAILURES = 200;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;

/**
 * The client's address as Cloudflare reports it, hashed so the throttle table never holds
 * it in readable form. Rows are deleted once their window has passed.
 */
export async function clientAddress(c: Context): Promise<string> {
  const address = c.req.header('cf-connecting-ip') ?? '';
  return toBase64Url(await sha256(new TextEncoder().encode(address)));
}

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
 * throttling per email and address, and per email overall. Unknown emails count failures
 * too, so they behave the same. Every attempt is counted before the key is checked, so
 * parallel requests can't get past the limits; a right key then clears the counts.
 */
export async function checkProof(
  db: D1Database,
  email: string,
  address: string,
  keyring: Keyring | null,
  loginKey: string,
): Promise<ProofResult> {
  const now = Date.now();
  const windowStart = now - FAILURE_WINDOW_MS;
  const fromHere = `${email} ${address}`;
  // One round trip: old windows go first, then both attempts are counted.
  const [, here, overall] = await db.batch([
    finishedWindowsQuery(db, windowStart),
    attemptQuery(db, fromHere, now, windowStart),
    attemptQuery(db, email, now, windowStart),
  ]);
  if (
    attemptCount(here?.results ?? []) > MAX_FAILURES ||
    attemptCount(overall?.results ?? []) > MAX_EMAIL_FAILURES
  ) {
    return 'throttled';
  }
  if (keyring && (await matchesAnyVerifier(keyring, loginKey))) {
    await clearFailures(db, [fromHere, email]);
    return 'ok';
  }
  return 'wrong';
}
