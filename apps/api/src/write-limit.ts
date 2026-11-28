import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import { STORAGE_SIZES } from '@arcafold/types';

import { countFor } from './account-counts';
import { LIMIT_SQL } from './db';
import type { Env } from './env';
import { messages } from './respond';
import type { AppEnv } from './session';

/**
 * Files in R2 count against each account's storage limit. What lands in the database
 * (sealed records, search and face data, invites) is limited here instead, per account and
 * per day, because the database is far smaller than R2 and one database serves everyone.
 * The day's count is kept with the account's other counts, outside the database
 * (src/counters.ts), so that no copy of the database shows how much an account wrote when.
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
 * Counts `bytes` against the account's day and says whether the day's total (this write
 * included) is still within its limit: FREE_DAILY_WRITE_BYTES, or a paid plan's storage
 * divided by PLAN_WRITE_SHARE if that's more. Counted before the write runs, and each count
 * runs whole, so parallel writes each get their own total. Logs when the database itself is
 * past `alertBytes`, so a filling database shows up well before it is full.
 */
export async function spendWrite(
  env: Env,
  accountId: string,
  bytes: number,
  now: number,
  alertBytes = DB_ALERT_BYTES,
): Promise<boolean> {
  const [total, [plan]] = await Promise.all([
    countFor(env, accountId, 'writes', bytes, now, WRITE_WINDOW_MS),
    env.DB.batch([
      env.DB.prepare(`SELECT ${LIMIT_SQL} AS limit_bytes`).bind(
        0,
        accountId,
        STORAGE_SIZES.accountQuota,
        now,
      ),
    ]),
  ]);
  const size: unknown = plan?.meta.size_after;
  if (typeof size === 'number' && size > alertBytes) {
    console.error(`The database is ${String(Math.round(size / 1e6))} MB, nearing its limit.`);
  }
  const limit = (plan?.results[0] as { limit_bytes: number } | undefined)?.limit_bytes ?? 0;
  return total <= Math.max(FREE_DAILY_WRITE_BYTES, Math.floor(limit / PLAN_WRITE_SHARE));
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
  const allowed = await spendWrite(
    c.env,
    c.get('account').id,
    Math.max(bytes, MIN_WRITE_BYTES),
    Date.now(),
  );
  return allowed ? next() : c.json({ error: messages.tooManyWrites }, 429);
});
