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

export async function deleteSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

/** Failures recorded for this email in the current window (0 once the window has passed). */
export async function recentFailures(
  db: D1Database,
  email: string,
  windowStart: number,
): Promise<number> {
  const row = await db
    .prepare('SELECT failures FROM login_failures WHERE email = ? AND window_start > ?')
    .bind(email, windowStart)
    .first<{ failures: number }>();
  return row?.failures ?? 0;
}

/** Counts a failure, starting a new window if the old one has passed. */
export async function recordFailure(
  db: D1Database,
  email: string,
  now: number,
  windowStart: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO login_failures (email, window_start, failures) VALUES (?1, ?2, 1)
       ON CONFLICT (email) DO UPDATE SET
         failures = CASE WHEN window_start > ?3 THEN failures + 1 ELSE 1 END,
         window_start = CASE WHEN window_start > ?3 THEN window_start ELSE ?2 END`,
    )
    .bind(email, now, windowStart)
    .run();
}

export async function clearFailures(db: D1Database, email: string): Promise<void> {
  await db.prepare('DELETE FROM login_failures WHERE email = ?').bind(email).run();
}
