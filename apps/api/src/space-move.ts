import { fromBase64Url, sha256, toBase64Url } from '@arcafold/crypto/webcrypto';

/**
 * Moving a space to a new access token, so its old token stops working (a new main password
 * or recovery key moves the main library; see docs/security.md).
 *
 * Every row a space has is kept under its tag, the SHA-256 of its token, in one of these
 * tables, so a move is one UPDATE per table, run in the same batch as the new keyring. Files
 * in R2 are named by photo id, not by space, so they stay where they are. Share tokens and
 * phones' upload tokens name the space by its tag too, so they move with it and keep working.
 * A test checks this list against every table with a `space` column.
 *
 * The old tag goes into `moved_spaces`, which has no `space` column so that it never moves:
 * from then on the server refuses the old token (see `requireSpace`), so nothing can be added
 * under it by a tab that still holds the old keys.
 */
export const SPACE_TABLES = [
  'photos',
  'albums',
  'album_items',
  'album_removed',
  'folder_edits',
  'members',
  'joined',
  'pending_invites',
  'profile_photos',
  'people',
  'face_segments',
  'search_segments',
  'search_words',
  'smart_albums',
  'upload_keys',
  'upload_tokens',
  'space_stamps',
] as const;

/** The tags a space moves between. */
export interface SpaceMoveTags {
  from: string;
  to: string;
}

/** The tag a space token's rows are kept under. */
export async function spaceTag(token: string): Promise<string> {
  const bytes = fromBase64Url(token);
  if (!bytes) throw new Error('Malformed space token');
  return toBase64Url(await sha256(bytes));
}

/**
 * Whether anything is kept under a tag, a share or upload token hashes to it, or a space
 * moved away from it. A space only moves to a tag nothing uses, so a move can never merge two
 * spaces, take over a token or bring a moved one back.
 */
export async function tagInUse(db: D1Database, tag: string): Promise<boolean> {
  const checks = [
    ...SPACE_TABLES.map((table) => `EXISTS (SELECT 1 FROM ${table} WHERE space = ?1)`),
    'EXISTS (SELECT 1 FROM members WHERE token_hash = ?1)',
    'EXISTS (SELECT 1 FROM upload_tokens WHERE token_hash = ?1)',
    'EXISTS (SELECT 1 FROM moved_spaces WHERE tag = ?1)',
  ];
  const row = await db
    .prepare(`SELECT ${checks.join(' OR ')} AS used`)
    .bind(tag)
    .first<{ used: number }>();
  return row?.used === 1;
}

/**
 * The statements that move every row from one tag to the other and mark the old tag as moved.
 * Each runs only where `condition` (SQL, with `params` for its placeholders) holds, so a batch
 * can make the move depend on its first statement having taken effect.
 */
export function moveStatements(
  db: D1Database,
  move: SpaceMoveTags,
  condition: string,
  params: readonly (string | number)[],
): D1PreparedStatement[] {
  return [
    ...SPACE_TABLES.map((table) =>
      db
        .prepare(`UPDATE ${table} SET space = ? WHERE space = ? AND ${condition}`)
        .bind(move.to, move.from, ...params),
    ),
    // OR IGNORE: a tag already moved from stays so, and the batch goes on.
    db
      .prepare(`INSERT OR IGNORE INTO moved_spaces (tag) SELECT ? WHERE ${condition}`)
      .bind(move.from, ...params),
  ];
}

/** Finds whether a space moved away from a tag, for the space middleware's batch. */
export function movedQuery(db: D1Database, tag: string): D1PreparedStatement {
  return db.prepare('SELECT 1 AS moved FROM moved_spaces WHERE tag = ?').bind(tag);
}
