import type { Device, DeviceKind, Keyring, SmartFeaturesChoice } from '@arcafold/types';

import type { DeviceLabel } from './device';
import { keyringSchema } from './schemas';

/** An account row with its keyring parsed. */
export interface AccountRecord {
  id: string;
  email: string;
  name: string;
  keyring: Keyring;
  version: number;
  smartFeatures: SmartFeaturesChoice | null;
}

interface AccountRow {
  id: string;
  email: string;
  name: string;
  keyring: string;
  version: number;
  smart_choice: string | null;
  smart_version: number | null;
}

/** The columns every account read selects, for a query that names accounts `a`. */
const ACCOUNT_COLUMNS =
  'a.id, a.email, a.name, a.keyring, a.version, a.smart_choice, a.smart_version';

function smartFeaturesOf(row: AccountRow): SmartFeaturesChoice | null {
  if ((row.smart_choice !== 'on' && row.smart_choice !== 'off') || row.smart_version === null) {
    return null;
  }
  return { choice: row.smart_choice, version: row.smart_version };
}

function toRecord(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    keyring: keyringSchema.parse(JSON.parse(row.keyring)),
    version: row.version,
    smartFeatures: smartFeaturesOf(row),
  };
}

export async function findAccountByEmail(
  db: D1Database,
  email: string,
): Promise<AccountRecord | null> {
  const row = await db
    .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts a WHERE a.email = ?`)
    .bind(email)
    .first<AccountRow>();
  return row ? toRecord(row) : null;
}

/** Inserts an account. Returns false if the email is taken. */
export async function insertAccount(
  db: D1Database,
  account: Omit<AccountRecord, 'version' | 'smartFeatures'>,
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

/** Changes the account's name. */
export async function updateName(db: D1Database, accountId: string, name: string): Promise<void> {
  await db.prepare('UPDATE accounts SET name = ? WHERE id = ?').bind(name, accountId).run();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Keeps the answer to the smart features question, with the day it was given (to the day,
 * like other times we keep, so it can't be lined up with other records).
 */
export async function updateSmartFeatures(
  db: D1Database,
  accountId: string,
  answer: SmartFeaturesChoice,
  now: number,
): Promise<void> {
  const day = now - (now % DAY_MS);
  await db
    .prepare('UPDATE accounts SET smart_choice = ?, smart_version = ?, smart_at = ? WHERE id = ?')
    .bind(answer.choice, answer.version, day, accountId)
    .run();
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

/** How many bytes the account stores across all its spaces (uploads in progress included). */
export async function storedBytes(db: D1Database, accountId: string): Promise<number> {
  const row = await db
    .prepare('SELECT stored_bytes FROM accounts WHERE id = ?')
    .bind(accountId)
    .first<{ stored_bytes: number }>();
  return row?.stored_bytes ?? 0;
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

/** The account behind an unexpired session, as a statement so it can share a batch. */
export function sessionAccountQuery(
  db: D1Database,
  tokenHash: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT ${ACCOUNT_COLUMNS}
         FROM sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(tokenHash, now);
}

/** Reads the row sessionAccountQuery found, if any. */
export function sessionAccountFrom(rows: readonly unknown[]): AccountRecord | null {
  const row = rows[0] as AccountRow | undefined;
  return row ? toRecord(row) : null;
}

/** The account behind an unexpired session. */
export async function findSessionAccount(
  db: D1Database,
  tokenHash: string,
  now: number,
): Promise<AccountRecord | null> {
  const { results } = await sessionAccountQuery(db, tokenHash, now).all();
  return sessionAccountFrom(results);
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

/** A session's last use is kept to the hour, so it can't be lined up with other records. */
export const ACTIVE_STEP_MS = 60 * 60 * 1000;

export function activeHour(now: number): number {
  return now - (now % ACTIVE_STEP_MS);
}

/**
 * Starts a session, first forgetting sessions that have run out (so old login times aren't
 * kept), in one round trip. Its public id is made by SQLite, like the ids given to sessions
 * from before devices were listed.
 */
export async function insertSession(
  db: D1Database,
  session: {
    tokenHash: string;
    accountId: string;
    createdAt: number;
    expiresAt: number;
    device: DeviceLabel;
  },
): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(session.createdAt),
    db
      .prepare(
        `INSERT INTO sessions
           (token_hash, id, account_id, created_at, expires_at, device, device_kind, last_active)
         VALUES (?, lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        session.tokenHash,
        session.accountId,
        session.createdAt,
        session.expiresAt,
        session.device.name,
        session.device.kind,
        activeHour(session.createdAt),
      ),
  ]);
}

/** A live session with its account, and when it was last marked used. */
export interface SessionRecord {
  account: AccountRecord;
  lastActive: number;
}

export async function findSession(
  db: D1Database,
  tokenHash: string,
  now: number,
): Promise<SessionRecord | null> {
  const row = await db
    .prepare(
      `SELECT ${ACCOUNT_COLUMNS}, s.last_active
         FROM sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(tokenHash, now)
    .first<AccountRow & { last_active: number }>();
  return row ? { account: toRecord(row), lastActive: row.last_active } : null;
}

/**
 * Marks a session used this hour, relabeling it from the browser using it (sessions from
 * before devices were listed have no label until then).
 */
export async function touchSession(
  db: D1Database,
  tokenHash: string,
  now: number,
  device: DeviceLabel,
): Promise<void> {
  await db
    .prepare(
      'UPDATE sessions SET last_active = ?, device = ?, device_kind = ? WHERE token_hash = ?',
    )
    .bind(activeHour(now), device.name, device.kind, tokenHash)
    .run();
}

interface DeviceRow {
  id: string;
  device: string;
  device_kind: string;
  created_at: number;
  last_active: number;
  current: number;
}

function toDeviceKind(kind: string): DeviceKind {
  return kind === 'phone' || kind === 'tablet' ? kind : 'computer';
}

/** The account's live sessions, most recently used first. */
export async function listDevices(
  db: D1Database,
  accountId: string,
  currentTokenHash: string,
  now: number,
): Promise<Device[]> {
  const { results } = await db
    .prepare(
      `SELECT id, device, device_kind, created_at, last_active, token_hash = ? AS current
         FROM sessions
        WHERE account_id = ? AND expires_at > ?
        ORDER BY current DESC, last_active DESC, created_at DESC`,
    )
    .bind(currentTokenHash, accountId, now)
    .all<DeviceRow>();
  return results.map((row) => ({
    id: row.id,
    name: row.device,
    kind: toDeviceKind(row.device_kind),
    signedInAt: row.created_at,
    lastActive: row.last_active,
    current: row.current === 1,
  }));
}

/** Signs out one of the account's other devices. False if there is no such device. */
export async function deleteOtherSession(
  db: D1Database,
  accountId: string,
  id: string,
  keepTokenHash: string,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM sessions WHERE id = ? AND account_id = ? AND token_hash != ?')
    .bind(id, accountId, keepTokenHash)
    .run();
  return result.meta.changes > 0;
}

export async function deleteSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

/**
 * Counts an attempt as a failure before it is checked, starting a new window if the old one
 * has passed; the statement returns the count including this attempt. Counting first, in one
 * statement, means concurrent requests can't all read a count under the limit and then all
 * be checked: each one gets its own number.
 */
export function attemptQuery(
  db: D1Database,
  email: string,
  now: number,
  windowStart: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO login_failures (email, window_start, failures) VALUES (?1, ?2, 1)
       ON CONFLICT (email) DO UPDATE SET
         failures = CASE WHEN window_start > ?3 THEN failures + 1 ELSE 1 END,
         window_start = CASE WHEN window_start > ?3 THEN window_start ELSE ?2 END
       RETURNING failures`,
    )
    .bind(email, now, windowStart);
}

/** The count an attemptQuery returned. */
export function attemptCount(rows: readonly unknown[]): number {
  const row = rows[0] as { failures: number } | undefined;
  if (!row) throw new Error('The attempt was not counted');
  return row.failures;
}

/** Counts one attempt (see attemptQuery) and returns the count including it. */
export async function takeAttempt(
  db: D1Database,
  email: string,
  now: number,
  windowStart: number,
): Promise<number> {
  const { results } = await attemptQuery(db, email, now, windowStart).all();
  return attemptCount(results);
}

/** Gives back an attempt that turned out not to be a failure. */
export async function returnAttempt(db: D1Database, email: string): Promise<void> {
  await db
    .prepare('UPDATE login_failures SET failures = failures - 1 WHERE email = ? AND failures > 0')
    .bind(email)
    .run();
}

/** Forgets failure counts whose window has passed, and the emails typed with them. */
export function finishedWindowsQuery(db: D1Database, windowStart: number): D1PreparedStatement {
  return db.prepare('DELETE FROM login_failures WHERE window_start <= ?').bind(windowStart);
}

/** Forgets the failure counts of these keys (an email, or an email and address). */
export async function clearFailures(db: D1Database, keys: readonly string[]): Promise<void> {
  await db.batch(
    keys.map((key) => db.prepare('DELETE FROM login_failures WHERE email = ?').bind(key)),
  );
}
