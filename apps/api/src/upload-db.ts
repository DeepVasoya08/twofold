/**
 * Upload-only keys and tokens (migration 0018). Rows are keyed by the space tag only and
 * never name an account.
 */

/** The most phones that can back up to one space at once. */
export const MAX_UPLOAD_TOKENS = 20;

export function uploadTokenQuery(db: D1Database, tokenHash: string): D1PreparedStatement {
  return db.prepare('SELECT id, space FROM upload_tokens WHERE token_hash = ?').bind(tokenHash);
}

export async function findUploadKey(db: D1Database, space: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT meta FROM upload_keys WHERE space = ?')
    .bind(space)
    .first<{ meta: string }>();
  return row?.meta ?? null;
}

/** Keeps the space's upload key. Returns false if it already has one, which is kept. */
export async function insertUploadKey(
  db: D1Database,
  space: string,
  meta: string,
): Promise<boolean> {
  const result = await db
    .prepare('INSERT INTO upload_keys (space, meta) VALUES (?, ?) ON CONFLICT (space) DO NOTHING')
    .bind(space, meta)
    .run();
  return result.meta.changes === 1;
}

export async function listUploadTokens(db: D1Database, space: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT id FROM upload_tokens WHERE space = ? ORDER BY id')
    .bind(space)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

/**
 * Registers a phone's upload token, unless the space has its most already. Returns false
 * if it wasn't added: too many, or the id or token is taken.
 */
export async function insertUploadToken(
  db: D1Database,
  space: string,
  id: string,
  tokenHash: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO upload_tokens (id, token_hash, space)
       SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM upload_tokens WHERE space = ?) < ?
       ON CONFLICT DO NOTHING`,
    )
    .bind(id, tokenHash, space, space, MAX_UPLOAD_TOKENS)
    .run();
  return result.meta.changes === 1;
}

export async function deleteUploadToken(
  db: D1Database,
  space: string,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM upload_tokens WHERE space = ? AND id = ?')
    .bind(space, id)
    .run();
  return result.meta.changes === 1;
}

/** Forgets the space's upload key and every phone's token, when the space is wiped. */
export async function deleteUploadKeys(db: D1Database, space: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM upload_keys WHERE space = ?').bind(space),
    db.prepare('DELETE FROM upload_tokens WHERE space = ?').bind(space),
  ]);
}
