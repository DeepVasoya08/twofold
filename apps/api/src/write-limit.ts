import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import { EMAIL_SECRET_MIN_LENGTH, emailCodeScope } from '@arcafold/crypto/webcrypto';
import { STORAGE_SIZES } from '@arcafold/types';

import { LIMIT_SQL } from './db';
import { messages } from './respond';
import type { AppEnv } from './session';

/**
 * Files in R2 count against each account's storage limit. What lands in the database
 * (sealed records, search and face data, invites) is limited here instead, per account and
 * per day, because the database is far smaller than R2 and one database serves everyone.
 */
export const WRITE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A day's limit on Free (and without a plan): far more than a whole Free library's records. */
export const FREE_DAILY_WRITE_BYTES = 32 * 1024 * 1024;
/** A paid plan may add 1/PLAN_WRITE_SHARE of its storage a day, if that is more. */
export const PLAN_WRITE_SHARE = 256;
/** Least a write counts as, so that tiny writes still pay for the rows they add. */
export const MIN_WRITE_BYTES = 512;
/** Past this size the database is logged as getting full (D1 databases stop at 10 GB). */
export const DB_ALERT_BYTES = 5 * 1000 ** 3;

/**
 * Counts `bytes` against the account's day, under `key`, and says whether the day's total
 * (this write included) is still within its limit: FREE_DAILY_WRITE_BYTES, or a paid plan's
 * storage divided by PLAN_WRITE_SHARE if that's more. One round trip, before the write runs,
 * so parallel writes each get their own total. Logs when the database itself is past
 * `alertBytes`, so a filling database shows up well before it is full.
 */
export async function spendWrite(
  db: D1Database,
  key: string,
  accountId: string,
  bytes: number,
  now: number,
  alertBytes = DB_ALERT_BYTES,
): Promise<boolean> {
  const windowStart = now - WRITE_WINDOW_MS;
  const [, spent, plan] = await db.batch([
    db.prepare('DELETE FROM write_budgets WHERE window_start <= ?').bind(windowStart),
    db
      .prepare(
        `INSERT INTO write_budgets (key, window_start, bytes) VALUES (?1, ?2, ?3)
         ON CONFLICT (key) DO UPDATE SET
           bytes = CASE WHEN window_start > ?4 THEN bytes + ?3 ELSE ?3 END,
           window_start = CASE WHEN window_start > ?4 THEN window_start ELSE ?2 END
         RETURNING bytes`,
      )
      .bind(key, now, bytes, windowStart),
    db
      .prepare(`SELECT ${LIMIT_SQL} AS limit_bytes`)
      .bind(0, accountId, STORAGE_SIZES.accountQuota, now),
  ]);
  const size: unknown = spent?.meta.size_after;
  if (typeof size === 'number' && size > alertBytes) {
    console.error(`The database is ${String(Math.round(size / 1e6))} MB, nearing its limit.`);
  }
  const total = (spent?.results[0] as { bytes: number } | undefined)?.bytes ?? Infinity;
  const limit = (plan?.results[0] as { limit_bytes: number } | undefined)?.limit_bytes ?? 0;
  return total <= Math.max(FREE_DAILY_WRITE_BYTES, Math.floor(limit / PLAN_WRITE_SHARE));
}

/**
 * What the account's day is counted under: an HMAC of its id under the Worker's secret
 * where there is one, so the table never says whose day it is; otherwise the id itself.
 */
async function writeKey(secret: string | undefined, accountId: string): Promise<string> {
  return secret !== undefined && secret.length >= EMAIL_SECRET_MIN_LENGTH
    ? emailCodeScope(secret, 'daily writes', accountId)
    : `account ${accountId}`;
}

/**
 * The size of a request's body: its Content-Length, or, without one, the body itself
 * measured (Hono keeps it, so the route can still read it).
 */
async function bodySize(c: Context): Promise<number> {
  const length = Number(c.req.header('content-length') ?? Number.NaN);
  if (Number.isInteger(length) && length >= 0) return length;
  return new TextEncoder().encode(await c.req.text()).length;
}

/**
 * Counts what a request may add to the database against its account's day, before it runs,
 * by the size of its body, and refuses it (429) once the day's limit is reached. File
 * uploads (application/octet-stream) go to R2 and count against storage instead; reads and
 * deletes add nothing. Needs the account, so it runs after the session check.
 */
export const limitWrites = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method !== 'POST' && c.req.method !== 'PUT') return next();
  if (c.req.header('content-type')?.startsWith('application/octet-stream')) return next();
  const bytes = await bodySize(c);
  const accountId = c.get('account').id;
  const key = await writeKey(c.env.EMAIL_CODE_SECRET, accountId);
  const allowed = await spendWrite(
    c.env.DB,
    key,
    accountId,
    Math.max(bytes, MIN_WRITE_BYTES),
    Date.now(),
  );
  return allowed ? next() : c.json({ error: messages.tooManyWrites }, 429);
});
