import type { InviterView, JoinerView, StoredJoined, StoredMember } from '@twofold/types';

/**
 * Sharing queries. Members and joined libraries are scoped to a space tag, like photos; no
 * row involves an account. Invites are addressed by hashes of their code and handle.
 */

/** The space a member's share token opens, and which member it is. */
export async function findMemberByToken(
  db: D1Database,
  tokenHash: string,
): Promise<{ id: string; space: string } | null> {
  return db
    .prepare('SELECT id, space FROM members WHERE token_hash = ?')
    .bind(tokenHash)
    .first<{ id: string; space: string }>();
}

export async function listMembers(db: D1Database, space: string): Promise<StoredMember[]> {
  const { results } = await db
    .prepare('SELECT id, meta FROM members WHERE space = ? ORDER BY id')
    .bind(space)
    .all<StoredMember>();
  return results;
}

async function count(db: D1Database, table: 'members' | 'joined', space: string) {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE space = ?`)
    .bind(space)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export const countMembers = (db: D1Database, space: string) => count(db, 'members', space);
export const countJoined = (db: D1Database, space: string) => count(db, 'joined', space);

/** Returns false if the id or token is taken. */
export async function insertMember(
  db: D1Database,
  space: string,
  member: { id: string; tokenHash: string; meta: string },
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO members (id, token_hash, space, meta) VALUES (?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .bind(member.id, member.tokenHash, space, member.meta)
    .run();
  return result.meta.changes === 1;
}

export async function deleteMember(db: D1Database, space: string, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM members WHERE space = ? AND id = ?')
    .bind(space, id)
    .run();
  return result.meta.changes === 1;
}

export async function listJoined(db: D1Database, space: string): Promise<StoredJoined[]> {
  const { results } = await db
    .prepare('SELECT id, meta FROM joined WHERE space = ? ORDER BY id')
    .bind(space)
    .all<StoredJoined>();
  return results;
}

/** Returns false if the id is taken. */
export async function insertJoined(
  db: D1Database,
  space: string,
  joined: StoredJoined,
): Promise<boolean> {
  const result = await db
    .prepare('INSERT INTO joined (id, space, meta) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING')
    .bind(joined.id, space, joined.meta)
    .run();
  return result.meta.changes === 1;
}

export async function deleteJoined(db: D1Database, space: string, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM joined WHERE space = ? AND id = ?')
    .bind(space, id)
    .run();
  return result.meta.changes === 1;
}

/** Forgets who a space is shared with and what it joined, when the space is wiped. */
export async function deleteSharing(db: D1Database, space: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM members WHERE space = ?').bind(space),
    db.prepare('DELETE FROM joined WHERE space = ?').bind(space),
  ]);
}

interface InviteRow {
  commitment: string;
  joiner_key: string | null;
  inviter_key: string | null;
  hello: string | null;
  grant_box: string | null;
}

export interface InviteRecord {
  commitment: string;
  joinerKey: string | null;
  inviterKey: string | null;
  hello: string | null;
  grant: string | null;
}

function toInvite(row: InviteRow): InviteRecord {
  return {
    commitment: row.commitment,
    joinerKey: row.joiner_key,
    inviterKey: row.inviter_key,
    hello: row.hello,
    grant: row.grant_box,
  };
}

export function joinerView(invite: InviteRecord): JoinerView {
  return { commitment: invite.commitment, inviterKey: invite.inviterKey, grant: invite.grant };
}

export function inviterView(invite: InviteRecord): InviterView {
  return { joinerKey: invite.joinerKey, hello: invite.hello };
}

/** Which hash an invite is looked up by: the joiner's code, or the inviter's handle. */
export type InviteSide = 'code_hash' | 'handle_hash';

/** Returns false if the code (or handle) is already in use. */
export async function insertInvite(
  db: D1Database,
  invite: { handleHash: string; codeHash: string; commitment: string; expiresAt: number },
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO invites (handle_hash, code_hash, commitment, expires_at) VALUES (?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .bind(invite.handleHash, invite.codeHash, invite.commitment, invite.expiresAt)
    .run();
  return result.meta.changes === 1;
}

export async function deleteExpiredInvites(db: D1Database, now: number): Promise<void> {
  await db.prepare('DELETE FROM invites WHERE expires_at <= ?').bind(now).run();
}

export async function findInvite(
  db: D1Database,
  side: InviteSide,
  hash: string,
  now: number,
): Promise<InviteRecord | null> {
  const row = await db
    .prepare(
      `SELECT commitment, joiner_key, inviter_key, hello, grant_box FROM invites
        WHERE ${side} = ? AND expires_at > ?`,
    )
    .bind(hash, now)
    .first<InviteRow>();
  return row ? toInvite(row) : null;
}

/**
 * Fills in one step of an invite, only if the step before it is done and this one isn't, so
 * every step happens once and in order. Returns false otherwise.
 */
const steps = {
  joiner_key: 'joiner_key IS NULL',
  inviter_key: 'joiner_key IS NOT NULL AND inviter_key IS NULL',
  hello: 'inviter_key IS NOT NULL AND hello IS NULL',
  grant_box: 'hello IS NOT NULL AND grant_box IS NULL',
} as const;

export type InviteStep = keyof typeof steps;

export async function fillInviteStep(
  db: D1Database,
  side: InviteSide,
  hash: string,
  step: InviteStep,
  value: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE invites SET ${step} = ? WHERE ${side} = ? AND expires_at > ? AND ${steps[step]}`,
    )
    .bind(value, hash, now)
    .run();
  return result.meta.changes === 1;
}

export async function deleteInvite(
  db: D1Database,
  side: InviteSide,
  hash: string,
): Promise<boolean> {
  const result = await db.prepare(`DELETE FROM invites WHERE ${side} = ?`).bind(hash).run();
  return result.meta.changes === 1;
}
