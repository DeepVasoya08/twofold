import type { Context } from 'hono';

import type { AccountCounters, WindowName } from './counters';
import { storageLimit, takeUnmovedBytes } from './db';
import type { Env } from './env';
import type { AppEnv } from './session';

/**
 * What the routes use of each account's counters (src/counters.ts): its storage total, its
 * day's writes and its wrong invite codes, all kept outside the database.
 */

/** The account's counters. */
export function countersOf(env: Env, accountId: string): DurableObjectStub<AccountCounters> {
  return env.COUNTERS.get(env.COUNTERS.idFromName(accountId));
}

/**
 * Moves the storage total the database still holds for the signed-in account, from before
 * totals moved out of it, to the account's counters. Only once: whichever request takes it
 * from the database adds it.
 */
async function moveOldTotal(
  c: Context<AppEnv>,
  counters: DurableObjectStub<AccountCounters>,
): Promise<void> {
  const account = c.get('account');
  if (account.unmovedBytes <= 0) return;
  if (await takeUnmovedBytes(c.env.DB, account.id, account.unmovedBytes)) {
    await counters.add(account.unmovedBytes);
  }
  c.set('account', { ...account, unmovedBytes: 0 });
}

/**
 * Adds an upload's bytes to the signed-in account's total, only if that stays within its
 * limit at `now` (its plan's). Returns false if it would go over.
 */
export async function reserveStorage(
  c: Context<AppEnv>,
  bytes: number,
  now: number,
): Promise<boolean> {
  const accountId = c.get('account').id;
  const counters = countersOf(c.env, accountId);
  const [limit] = await Promise.all([
    storageLimit(c.env.DB, accountId, now),
    moveOldTotal(c, counters),
  ]);
  return counters.reserve(bytes, limit);
}

/**
 * Gives bytes back to the signed-in account (never below zero). Storage isn't linked to
 * accounts, so the account deleting something is the only one it can go to.
 */
export async function releaseStorage(c: Context<AppEnv>, bytes: number): Promise<void> {
  if (bytes <= 0) return;
  const counters = countersOf(c.env, c.get('account').id);
  await moveOldTotal(c, counters);
  await counters.release(bytes);
}

/** How many bytes the signed-in account stores across all its spaces. */
export async function storedBytes(c: Context<AppEnv>): Promise<number> {
  const counters = countersOf(c.env, c.get('account').id);
  await moveOldTotal(c, counters);
  return counters.stored();
}

/** Counts `amount` against the account's window `name`, returning the window's total. */
export async function countFor(
  env: Env,
  accountId: string,
  name: WindowName,
  amount: number,
  now: number,
  windowMs: number,
): Promise<number> {
  return countersOf(env, accountId).count(name, amount, now, windowMs);
}
