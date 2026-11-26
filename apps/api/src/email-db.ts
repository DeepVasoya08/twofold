/** Pending email codes (migration 0022). Only HMACs of codes and scopes are stored. */

export interface EmailCodeRow {
  tag: string;
  expiresAt: number;
  tries: number;
  sentAt: number;
  sends: number;
  sendsSince: number;
}

interface Row {
  tag: string;
  expires_at: number;
  tries: number;
  sent_at: number;
  sends: number;
  sends_since: number;
}

export async function findEmailCode(db: D1Database, scope: string): Promise<EmailCodeRow | null> {
  const row = await db
    .prepare(
      'SELECT tag, expires_at, tries, sent_at, sends, sends_since FROM email_codes WHERE scope = ?',
    )
    .bind(scope)
    .first<Row>();
  return row
    ? {
        tag: row.tag,
        expiresAt: row.expires_at,
        tries: row.tries,
        sentAt: row.sent_at,
        sends: row.sends,
        sendsSince: row.sends_since,
      }
    : null;
}

/**
 * Keeps a new code for a scope, replacing any earlier one (its tries start again), and
 * counts the send. Only if the scope's last send was before `sentBefore`, so two requests
 * at once can't both send: returns false if another send got there first.
 */
export async function saveEmailCode(
  db: D1Database,
  code: {
    scope: string;
    accountId: string | null;
    tag: string;
    expiresAt: number;
    sentAt: number;
    sends: number;
    sendsSince: number;
  },
  sentBefore: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO email_codes (scope, account_id, tag, expires_at, tries, sent_at, sends, sends_since)
       VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7)
       ON CONFLICT (scope) DO UPDATE SET
         account_id = excluded.account_id, tag = excluded.tag, expires_at = excluded.expires_at,
         tries = 0, sent_at = excluded.sent_at, sends = excluded.sends,
         sends_since = excluded.sends_since
       WHERE email_codes.sent_at < ?8`,
    )
    .bind(
      code.scope,
      code.accountId,
      code.tag,
      code.expiresAt,
      code.sentAt,
      code.sends,
      code.sendsSince,
      sentBefore,
    )
    .run();
  return result.meta.changes === 1;
}

/**
 * Counts one try at a scope's code before it's checked, so parallel guesses can't get past
 * the limit. Returns the stored tag, or null if there is no live code or its tries are used up.
 */
export async function takeEmailCodeTry(
  db: D1Database,
  scope: string,
  maxTries: number,
  now: number,
): Promise<string | null> {
  const row = await db
    .prepare(
      'UPDATE email_codes SET tries = tries + 1 WHERE scope = ? AND tries < ? AND expires_at > ? RETURNING tag',
    )
    .bind(scope, maxTries, now)
    .first<{ tag: string }>();
  return row?.tag ?? null;
}

/**
 * Counts a send against a limit-only scope (no code), starting the count again once the
 * hour since `sends_since` has passed. Returns the sends counted in this hour.
 */
export function countSendQuery(
  db: D1Database,
  scope: string,
  now: number,
  hourAgo: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO email_codes (scope, account_id, tag, expires_at, tries, sent_at, sends, sends_since)
       VALUES (?1, NULL, '', ?2 + 3600000, 0, ?2, 1, ?2)
       ON CONFLICT (scope) DO UPDATE SET
         sends = CASE WHEN email_codes.sends_since <= ?3 THEN 1 ELSE email_codes.sends + 1 END,
         sends_since = CASE WHEN email_codes.sends_since <= ?3 THEN ?2 ELSE email_codes.sends_since END,
         sent_at = ?2,
         expires_at = ?2 + 3600000
       RETURNING sends`,
    )
    .bind(scope, now, hourAgo);
}

/**
 * Deletes rows nobody can use any more: expired a day ago (ticket and code rows, and the
 * hourly counts of sign-up addresses), so the table doesn't grow.
 */
export function deleteStaleCodesQuery(db: D1Database, now: number): D1PreparedStatement {
  return db.prepare('DELETE FROM email_codes WHERE expires_at < ?').bind(now - 24 * 60 * 60 * 1000);
}

/** Forgets a scope's code once it has been used. */
export function deleteEmailCodeQuery(db: D1Database, scope: string): D1PreparedStatement {
  return db.prepare('DELETE FROM email_codes WHERE scope = ?').bind(scope);
}

/** Marks the account's email as verified, changing the address too if `email` differs. */
export function verifyEmailQuery(
  db: D1Database,
  accountId: string,
  email: string,
): D1PreparedStatement {
  return db
    .prepare('UPDATE accounts SET email = ?, email_verified = 1 WHERE id = ?')
    .bind(email, accountId);
}

/** Whether another account already uses this email. */
export async function emailInUse(
  db: D1Database,
  email: string,
  exceptId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS found FROM accounts WHERE email = ? AND id != ?')
    .bind(email, exceptId)
    .first<{ found: number }>();
  return row !== null;
}
