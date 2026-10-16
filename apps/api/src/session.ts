import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';

import { newSessionToken, sessionTokenHash } from '@twofold/crypto/webcrypto';

import { deleteSession, findSessionAccount, insertSession } from './db';
import type { AccountRecord } from './db';
import type { Env } from './env';

export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

export interface AppEnv {
  Bindings: Env;
  /**
   * Set by requireSpace: `space` is the tag of the space being accessed, and `member` the
   * member id when the request came with a share token rather than the owner's token.
   */
  Variables: { account: AccountRecord; space: string; member: string | null };
}

/**
 * Over HTTPS the cookie gets the __Host- prefix and Secure. Plain http only happens in local
 * development (wrangler dev), where a Secure cookie would not be sent back.
 */
function cookieName(c: Context): string {
  return isSecure(c) ? '__Host-twofold_session' : 'twofold_session';
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

/** Rejects the request with 401 unless it carries a live session. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, cookieName(c));
  const sessionHash = token ? await sessionTokenHash(token) : null;
  const account = sessionHash ? await findSessionAccount(c.env.DB, sessionHash, Date.now()) : null;
  if (!account || !sessionHash) {
    clearSessionCookie(c);
    return c.json({ error: 'Your session has ended. Log in again.' }, 401);
  }
  c.set('account', account);
  return next();
});
