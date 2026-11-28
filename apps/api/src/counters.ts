import { DurableObject } from 'cloudflare:workers';

/**
 * One account's running counts, kept in a Durable Object of their own rather than in the
 * database: the bytes the account stores across all its spaces, what it added to the
 * database in the last day, and its recent wrong invite codes. Each of these moves when one
 * of the account's spaces changes, so in the database two copies (two nightly backups, or two
 * points of its 30-day history) could line an account up with the spaces whose rows changed
 * in between. Nothing here names a space (docs/security.md#account-totals-live-outside-the-database).
 *
 * Every method reads and writes storage synchronously, so each call runs whole before the
 * next one starts and parallel uploads can't together go over a limit.
 */
export class AccountCounters extends DurableObject {
  /** Adds bytes with no limit: a total moved here from the database. */
  add(bytes: number): void {
    const storage = this.ctx.storage.kv;
    storage.put(STORED_KEY, stored(storage) + checkedAmount(bytes));
  }

  /**
   * Adds an upload's bytes to the total, only if that stays within `limit` (the account's
   * plan's). Returns whether it did.
   */
  reserve(bytes: number, limit: number): boolean {
    const storage = this.ctx.storage.kv;
    const total = stored(storage) + checkedAmount(bytes);
    if (total > checkedAmount(limit)) return false;
    storage.put(STORED_KEY, total);
    return true;
  }

  /** Gives bytes back (never below zero). */
  release(bytes: number): void {
    const storage = this.ctx.storage.kv;
    storage.put(STORED_KEY, Math.max(stored(storage) - checkedAmount(bytes), 0));
  }

  /** The bytes the account stores across all its spaces, uploads in progress included. */
  stored(): number {
    return stored(this.ctx.storage.kv);
  }

  /**
   * Counts `amount` in the window `name`, which starts at the first count after the last
   * window ended and lasts `windowMs`. Returns the window's total, this count included.
   */
  count(name: WindowName, amount: number, now: number, windowMs: number): number {
    const storage = this.ctx.storage.kv;
    const key = windowKey(name);
    const current = storage.get<CountWindow>(key);
    const window =
      current !== undefined && current.start > checkedAmount(now) - checkedAmount(windowMs)
        ? { start: current.start, total: current.total + checkedAmount(amount) }
        : { start: now, total: checkedAmount(amount) };
    storage.put(key, window);
    return window.total;
  }

  /** Takes back part of a count that turned out not to count (never below zero). */
  giveBack(name: WindowName, amount: number): void {
    const storage = this.ctx.storage.kv;
    const key = windowKey(name);
    const current = storage.get<CountWindow>(key);
    if (current === undefined) return;
    storage.put(key, { ...current, total: Math.max(current.total - checkedAmount(amount), 0) });
  }

  /** Forgets everything, when the account is deleted. */
  async forget(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

/** The windows counted here: a day's writes to the database, and wrong invite codes. */
export type WindowName = 'writes' | 'invite tries';

/** A window's count: when it started, and its total so far. */
export interface CountWindow {
  start: number;
  total: number;
}

/** Where the storage total is kept. */
export const STORED_KEY = 'stored bytes';

/** Where the window `name` is kept. */
export function windowKey(name: WindowName): string {
  return `window ${name}`;
}

function stored(storage: SyncKvStorage): number {
  return storage.get<number>(STORED_KEY) ?? 0;
}

/** Counts and limits are whole numbers of bytes (or tries), never negative. */
function checkedAmount(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('Not a count');
  return amount;
}
