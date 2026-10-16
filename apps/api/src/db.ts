import type { Keyring } from '@twofold/types';

import { keyringSchema } from './schemas';

/** An account row with its keyring parsed. */
export interface AccountRecord {
  id: string;
  email: string;
  name: string;
  keyring: Keyring;
  version: number;
}

interface AccountRow {
  id: string;
  email: string;
  name: string;
  keyring: string;
  version: number;
}

function toRecord(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    keyring: keyringSchema.parse(JSON.parse(row.keyring)),
    version: row.version,
  };
}

export async function findAccountByEmail(
  db: D1Database,
  email: string,
): Promise<AccountRecord | null> {
  const row = await db
    .prepare('SELECT id, email, name, keyring, version FROM accounts WHERE email = ?')
    .bind(email)
    .first<AccountRow>();
  return row ? toRecord(row) : null;
}

/** Inserts an account. Returns false if the email is taken. */
export async function insertAccount(
  db: D1Database,
  account: Omit<AccountRecord, 'version'>,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      'INSERT INTO accounts (id, email, name, keyring, version, created_at) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT (email) DO NOTHING',
    )
    .bind(account.id, account.email, account.name, JSON.stringify(account.keyring), now)
    .run();
  return result.meta.changes === 1;
}

/** Replaces the keyring if the version still matches. Returns false on a conflicting update. */
export async function updateKeyring(
  db: D1Database,
  accountId: string,
  expectedVersion: number,
  keyring: Keyring,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE accounts SET keyring = ?, version = version + 1 WHERE id = ? AND version = ?')
    .bind(JSON.stringify(keyring), accountId, expectedVersion)
    .run();
  return result.meta.changes === 1;
}

/**
 * Adds an upload's bytes to the account's total, only if that stays within `limit`. One
 * statement, so parallel uploads can't together go over. Returns false if it would.
 */
export async function reserveStorage(
  db: D1Database,
  accountId: string,
  bytes: number,
  limit: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      'UPDATE accounts SET stored_bytes = stored_bytes + ?1 WHERE id = ?2 AND stored_bytes + ?1 <= ?3',
    )
    .bind(bytes, accountId, limit)
    .run();
  return result.meta.changes === 1;
}

/** Gives bytes back to the account that deleted them (never below zero). */
export async function releaseStorage(
  db: D1Database,
  accountId: string,
  bytes: number,
): Promise<void> {
  if (bytes <= 0) return;
  await db
    .prepare('UPDATE accounts SET stored_bytes = MAX(stored_bytes - ?, 0) WHERE id = ?')
    .bind(bytes, accountId)
    .run();
}

export async function deleteAccount(db: D1Database, accountId: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE account_id = ?').bind(accountId),
    db.prepare('DELETE FROM accounts WHERE id = ?').bind(accountId),
  ]);
}

export async function insertSession(
  db: D1Database,
  session: { tokenHash: string; accountId: string; createdAt: number; expiresAt: number },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    )
    .bind(session.tokenHash, session.accountId, session.createdAt, session.expiresAt)
    .run();
}

/** The account behind an unexpired session. */
export async function findSessionAccount(
  db: D1Database,
  tokenHash: string,
  now: number,
): Promise<AccountRecord | null> {
  const row = await db
    .prepare(
      `SELECT a.id, a.email, a.name, a.keyring, a.version
         FROM sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(tokenHash, now)
    .first<AccountRow>();
  return row ? toRecord(row) : null;
}

/** Signs out every other device: used after the keyring changes. */
export async function deleteOtherSessions(
  db: D1Database,
  accountId: string,
  keepTokenHash: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM sessions WHERE account_id = ? AND token_hash != ?')
    .bind(accountId, keepTokenHash)
    .run();
}

/** Forgets sessions that have run out, so old login times aren't kept. */
export async function deleteExpiredSessions(db: D1Database, now: number): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now).run();
}

export async function deleteSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

/**
 * Counts an attempt as a failure before it is checked, starting a new window if the old one
 * has passed, and returns the count including this attempt. Counting first, in one
 * statement, means concurrent requests can't all read a count under the limit and then all
 * be checked: each one gets its own number.
 */
export async function takeAttempt(
  db: D1Database,
  email: string,
  now: number,
  windowStart: number,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO login_failures (email, window_start, failures) VALUES (?1, ?2, 1)
       ON CONFLICT (email) DO UPDATE SET
         failures = CASE WHEN window_start > ?3 THEN failures + 1 ELSE 1 END,
         window_start = CASE WHEN window_start > ?3 THEN window_start ELSE ?2 END
       RETURNING failures`,
    )
    .bind(email, now, windowStart)
    .first<{ failures: number }>();
  if (!row) throw new Error('The attempt was not counted');
  return row.failures;
}

/** Gives back an attempt that turned out not to be a failure. */
export async function returnAttempt(db: D1Database, email: string): Promise<void> {
  await db
    .prepare('UPDATE login_failures SET failures = failures - 1 WHERE email = ? AND failures > 0')
    .bind(email)
    .run();
}

/** Forgets failure counts whose window has passed, and the emails typed with them. */
export async function deleteFinishedWindows(db: D1Database, windowStart: number): Promise<void> {
  await db.prepare('DELETE FROM login_failures WHERE window_start <= ?').bind(windowStart).run();
}

export async function clearFailures(db: D1Database, email: string): Promise<void> {
  await db.prepare('DELETE FROM login_failures WHERE email = ?').bind(email).run();
}
