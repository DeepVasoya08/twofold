import type { Context } from 'hono';

import {
  constantTimeEqual,
  fromBase64Url,
  loginVerifier,
  sha256,
  toBase64Url,
} from '@arcafold/crypto/webcrypto';
import type { Keyring } from '@arcafold/types';

import {
  attemptCount,
  attemptQuery,
  attemptWithinQuery,
  clearFailures,
  finishedWindowsQuery,
} from './db';

/**
 * Ten wrong passwords per email from one internet address per 15 minutes, then 429 until
 * the window passes. Someone else's address doesn't count against yours, so nobody can lock
 * you out by guessing from theirs.
 */
export const MAX_FAILURES = 10;
/**
 * A ceiling per email across every address, so guessing from many addresses at once still
 * stops. Only attempts an address's own limit let through count towards it, so reaching it
 * takes 20 addresses (IPv6 ones counted by their /64), which one machine doesn't have.
 */
export const MAX_EMAIL_FAILURES = 200;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;

/**
 * The client's address as Cloudflare reports it, cut to the block it is limited by (see
 * addressBlock) and hashed so the throttle tables never hold it in readable form. Rows are
 * deleted once their window has passed.
 */
export async function clientAddress(c: Context): Promise<string> {
  const address = addressBlock(c.req.header('cf-connecting-ip') ?? '');
  return toBase64Url(await sha256(new TextEncoder().encode(address)));
}

/**
 * What limits per internet address count by: an IPv4 address as it is, and an IPv6 address
 * by its first 64 bits. A home, phone or server connection is given a whole /64, so counting
 * single IPv6 addresses would give anyone more addresses than any limit. An IPv4 address
 * written as IPv6 (::ffff:a.b.c.d) counts as that IPv4 address. Anything else is kept as
 * it is.
 */
export function addressBlock(address: string): string {
  const groups = ipv6Groups(address);
  if (!groups) return address;
  const [a, b, c, d, e, f, g, h] = groups;
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) {
    return [g >> 8, g & 0xff, h >> 8, h & 0xff].join('.');
  }
  return `${[a, b, c, d].map((group) => group.toString(16)).join(':')}::/64`;
}

/** The eight 16-bit groups of an IPv6 address, or null if it isn't one. */
function ipv6Groups(
  address: string,
): [number, number, number, number, number, number, number, number] | null {
  if (!address.includes(':')) return null;
  let host: string;
  try {
    // The URL parser checks the address and writes it one standard way: lower-case hex
    // groups, the longest run of zero groups as "::", and an IPv4 tail as two hex groups.
    host = new URL(`http://[${address}]/`).hostname;
  } catch {
    return null;
  }
  const inner = /^\[([0-9a-f:]+)\]$/.exec(host)?.[1];
  if (inner === undefined) return null;
  const [head = '', tail, extra] = inner.split('::');
  if (extra !== undefined) return null;
  const parts = (text: string) => (text === '' ? [] : text.split(':'));
  const front = parts(head);
  const back = tail === undefined ? [] : parts(tail);
  const gap = 8 - front.length - back.length;
  if (gap < 0 || (tail === undefined && gap !== 0)) return null;
  const groups = [...front, ...Array<string>(gap).fill('0'), ...back].map((group) =>
    Number.parseInt(group, 16),
  );
  if (groups.some((group) => !(group >= 0 && group <= 0xffff))) return null;
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = groups;
  return [a, b, c, d, e, f, g, h];
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
  // One round trip: old windows go first, then the attempt is counted against this address,
  // and against the email's ceiling only if this address was still within its own limit.
  const [, here, overall] = await db.batch([
    finishedWindowsQuery(db, windowStart),
    attemptQuery(db, fromHere, now, windowStart),
    attemptWithinQuery(db, email, fromHere, MAX_FAILURES, now, windowStart),
  ]);
  if (attemptCount(here?.results ?? []) > MAX_FAILURES) return 'throttled';
  if (attemptCount(overall?.results ?? []) > MAX_EMAIL_FAILURES) return 'throttled';
  if (keyring && (await matchesAnyVerifier(keyring, loginKey))) {
    await clearFailures(db, [fromHere, email]);
    return 'ok';
  }
  return 'wrong';
}
