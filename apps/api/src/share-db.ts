import type {
  InviterView,
  MemberAccess,
  JoinerView,
  StoredJoined,
  StoredMember,
  StoredPendingInvite,
} from '@arcafold/types';

/**
 * Sharing queries. Members, joined libraries and pending invites are scoped to a space tag,
 * like photos; no row involves an account. Invites are addressed by hashes of their code,
 * link and handle.
 */

/**
 * The space a member's share token opens, which member it is, what it may do there, and the
 * album it is limited to, if it was given one album rather than the whole library.
 */
export function memberByTokenQuery(db: D1Database, tokenHash: string): D1PreparedStatement {
  return db
    .prepare('SELECT id, space, album, access FROM members WHERE token_hash = ?')
    .bind(tokenHash);
}

export async function listMembers(db: D1Database, space: string): Promise<StoredMember[]> {
  const { results } = await db
    .prepare('SELECT id, meta, album, access FROM members WHERE space = ? ORDER BY id')
    .bind(space)
    .all<StoredMember>();
  return results;
}

async function count(db: D1Database, sql: string, ...values: string[]) {
  const row = await db
    .prepare(sql)
    .bind(...values)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/** People the whole library is shared with. */
export const countMembers = (db: D1Database, space: string) =>
  count(db, 'SELECT COUNT(*) AS count FROM members WHERE space = ? AND album IS NULL', space);
/** People one album is shared with. */
export const countAlbumMembers = (db: D1Database, space: string, album: string) =>
  count(db, 'SELECT COUNT(*) AS count FROM members WHERE space = ? AND album = ?', space, album);
export const countJoined = (db: D1Database, space: string) =>
  count(db, 'SELECT COUNT(*) AS count FROM joined WHERE space = ?', space);
export const countPendingInvites = (db: D1Database, space: string) =>
  count(db, 'SELECT COUNT(*) AS count FROM pending_invites WHERE space = ?', space);

/**
 * Adds someone the library (or one album, with `album`) is shared with, unless that already
 * has `cap` people. Counted in the same statement, so requests at the same moment can't
 * pass the cap. Returns false if the id or token is taken, or the cap is reached.
 */
export async function insertMember(
  db: D1Database,
  space: string,
  member: {
    id: string;
    tokenHash: string;
    meta: string;
    album: string | null;
    access: MemberAccess;
  },
  cap: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO members (id, token_hash, space, meta, album, access)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
        WHERE (SELECT COUNT(*) FROM members WHERE space = ?3 AND album IS ?5) < ?7
       ON CONFLICT DO NOTHING`,
    )
    .bind(member.id, member.tokenHash, space, member.meta, member.album, member.access, cap)
    .run();
  return result.meta.changes === 1;
}

/**
 * Changes what someone the library, or one album of it, is shared with may do. Returns false
 * if this space has no such member.
 */
export async function updateMemberAccess(
  db: D1Database,
  space: string,
  id: string,
  access: MemberAccess,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE members SET access = ? WHERE space = ? AND id = ?')
    .bind(access, space, id)
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

/**
 * Keeps a library this space joined, unless it already keeps `cap` of them (counted in the
 * same statement). Returns false if the id is taken or the cap is reached.
 */
export async function insertJoined(
  db: D1Database,
  space: string,
  joined: StoredJoined,
  cap: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO joined (id, space, meta)
       SELECT ?1, ?2, ?3
        WHERE (SELECT COUNT(*) FROM joined WHERE space = ?2) < ?4
       ON CONFLICT (id) DO NOTHING`,
    )
    .bind(joined.id, space, joined.meta, cap)
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

export async function listPendingInvites(
  db: D1Database,
  space: string,
): Promise<StoredPendingInvite[]> {
  const { results } = await db
    .prepare('SELECT id, meta FROM pending_invites WHERE space = ? ORDER BY id')
    .bind(space)
    .all<StoredPendingInvite>();
  return results;
}

/**
 * Keeps an invite in progress, unless the space already has `cap` of them (counted in the
 * same statement). Returns false if the id is taken or the cap is reached.
 */
export async function insertPendingInvite(
  db: D1Database,
  space: string,
  invite: StoredPendingInvite,
  cap: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO pending_invites (id, space, meta)
       SELECT ?1, ?2, ?3
        WHERE (SELECT COUNT(*) FROM pending_invites WHERE space = ?2) < ?4
       ON CONFLICT (id) DO NOTHING`,
    )
    .bind(invite.id, space, invite.meta, cap)
    .run();
  return result.meta.changes === 1;
}

/** Replaces an invite's sealed record. Returns false if this space has no such record. */
export async function updatePendingInvite(
  db: D1Database,
  space: string,
  id: string,
  meta: string,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE pending_invites SET meta = ? WHERE space = ? AND id = ?')
    .bind(meta, space, id)
    .run();
  return result.meta.changes === 1;
}

export async function deletePendingInvite(
  db: D1Database,
  space: string,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM pending_invites WHERE space = ? AND id = ?')
    .bind(space, id)
    .run();
  return result.meta.changes === 1;
}

/**
 * Forgets who a space is shared with, what it joined, the invites it has in progress and its
 * shared albums' items, when the space is wiped.
 */
export async function deleteSharing(db: D1Database, space: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM members WHERE space = ?').bind(space),
    db.prepare('DELETE FROM joined WHERE space = ?').bind(space),
    db.prepare('DELETE FROM pending_invites WHERE space = ?').bind(space),
    db.prepare('DELETE FROM album_items WHERE space = ?').bind(space),
    db.prepare('DELETE FROM album_removed WHERE space = ?').bind(space),
    db.prepare('DELETE FROM folder_edits WHERE space = ?').bind(space),
  ]);
}

interface InviteRow {
  commitment: string;
  joiner_key: string | null;
  inviter_key: string | null;
  intro: string | null;
  hello: string | null;
  grant_box: string | null;
}

export interface InviteRecord {
  commitment: string;
  joinerKey: string | null;
  inviterKey: string | null;
  intro: string | null;
  hello: string | null;
  grant: string | null;
}

function toInvite(row: InviteRow): InviteRecord {
  return {
    commitment: row.commitment,
    joinerKey: row.joiner_key,
    inviterKey: row.inviter_key,
    intro: row.intro,
    hello: row.hello,
    grant: row.grant_box,
  };
}

export function joinerView(invite: InviteRecord): JoinerView {
  return {
    commitment: invite.commitment,
    inviterKey: invite.inviterKey,
    intro: invite.intro,
    helloSent: invite.hello !== null,
    grant: invite.grant,
  };
}

export function inviterView(invite: InviteRecord): InviterView {
  return {
    joinerKey: invite.joinerKey,
    revealed: invite.inviterKey !== null,
    hello: invite.hello,
  };
}

/**
 * Which hash an invite is looked up by: the joiner's code or link token, or the inviter's
 * handle.
 */
export type InviteSide = 'code_hash' | 'link_hash' | 'handle_hash';

/** Returns false if the code, link or handle is already in use. */
export async function insertInvite(
  db: D1Database,
  invite: {
    handleHash: string;
    codeHash: string;
    linkHash: string;
    commitment: string;
    expiresAt: number;
  },
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO invites (handle_hash, code_hash, link_hash, commitment, expires_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .bind(invite.handleHash, invite.codeHash, invite.linkHash, invite.commitment, invite.expiresAt)
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
      `SELECT commitment, joiner_key, inviter_key, intro, hello, grant_box FROM invites
        WHERE ${side} = ? AND expires_at > ?`,
    )
    .bind(hash, now)
    .first<InviteRow>();
  return row ? toInvite(row) : null;
}

/**
 * Each step of an invite: the columns it fills, and what must hold first. A step only
 * happens if the step before it is done and this one isn't, so every step happens once and
 * in order. Revealing fills the inviter's key and its sealed name together.
 */
const steps = {
  joiner_key: { set: ['joiner_key'], when: 'joiner_key IS NULL' },
  reveal: {
    set: ['inviter_key', 'intro'],
    when: 'joiner_key IS NOT NULL AND inviter_key IS NULL',
  },
  hello: { set: ['hello'], when: 'inviter_key IS NOT NULL AND hello IS NULL' },
  grant_box: { set: ['grant_box'], when: 'hello IS NOT NULL AND grant_box IS NULL' },
} as const;

export type InviteStep = keyof typeof steps;

/** Fills in one step, with one value per column it sets. Returns false if it's out of order. */
export async function fillInviteStep(
  db: D1Database,
  side: InviteSide,
  hash: string,
  step: InviteStep,
  values: readonly string[],
  now: number,
): Promise<boolean> {
  const { set, when } = steps[step];
  if (values.length !== set.length) throw new Error('Wrong number of values for this step');
  const assignments = set.map((column) => `${column} = ?`).join(', ');
  const result = await db
    .prepare(`UPDATE invites SET ${assignments} WHERE ${side} = ? AND expires_at > ? AND ${when}`)
    .bind(...values, hash, now)
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
