import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';

import { newSessionToken, sessionTokenHash } from '@arcafold/crypto/webcrypto';
import type { MemberAccess } from '@arcafold/types';

import { ACTIVE_STEP_MS, deleteSession, findSession, insertSession, touchSession } from './db';
import type { AccountRecord } from './db';
import { describeDevice } from './device';
import type { Env } from './env';

export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

export interface AppEnv {
  Bindings: Env;
  /**
   * Set by requireSpace: `space` is the tag of the space being accessed, `member` the member
   * id when the request came with a share token rather than the owner's token, and `album`
   * the one album that token is limited to, if it was given an album rather than a library.
   */
  Variables: {
    account: AccountRecord;
    /** SHA-256 of this request's session token. */
    session: string;
    space: string;
    member: string | null;
    album: string | null;
    /**
     * What the token may do: always 'edit' for the space's own token, and 'upload' for a
     * phone's upload-only token (start, upload and commit photos, and nothing else).
     */
    access: MemberAccess | 'upload';
  };
}

/**
 * Over HTTPS the cookie gets the __Host- prefix and Secure. Plain http only happens in local
 * development (wrangler dev), where a Secure cookie would not be sent back.
 */
function cookieName(c: Context): string {
  return isSecure(c) ? '__Host-arcafold_session' : 'arcafold_session';
}

function isSecure(c: Context): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

export async function startSession(c: Context<AppEnv>, accountId: string): Promise<void> {
  const token = newSessionToken();
  const now = Date.now();
  await insertSession(c.env.DB, {
    tokenHash: await sessionTokenHash(token),
    accountId,
    createdAt: now,
    expiresAt: now + SESSION_MS,
    device: describeDevice(c.req.header('user-agent')),
  });
  setCookie(c, cookieName(c), token, {
    httpOnly: true,
    secure: isSecure(c),
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_MS / 1000,
  });
}

export async function endSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, cookieName(c));
  if (token) await deleteSession(c.env.DB, await sessionTokenHash(token));
  clearSessionCookie(c);
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, cookieName(c), { path: '/', secure: isSecure(c) });
}

/** SHA-256 of the session token this request carries, if it carries one. */
export async function requestSessionHash(c: Context): Promise<string | null> {
  const token = getCookie(c, cookieName(c));
  return token ? sessionTokenHash(token) : null;
}

/** The 401 for a request without a live session. */
export function sessionEnded(c: Context): Response {
  clearSessionCookie(c);
  return c.json({ error: 'Your session has ended. Log in again.' }, 401);
}

/**
 * Rejects the request with 401 unless it carries a live session. Account routes also mark
 * the session used, at most once an hour; storage routes don't, so a device's last use
 * isn't a record of when a space was opened.
 */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const sessionHash = await requestSessionHash(c);
  const now = Date.now();
  const session = sessionHash ? await findSession(c.env.DB, sessionHash, now) : null;
  if (!session || !sessionHash) return sessionEnded(c);
  if (now - session.lastActive >= ACTIVE_STEP_MS) {
    await touchSession(c.env.DB, sessionHash, now, describeDevice(c.req.header('user-agent')));
  }
  c.set('account', session.account);
  c.set('session', sessionHash);
  return next();
});
