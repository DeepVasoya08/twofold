import type { StoredWord } from '@twofold/types';

/**
 * Queries for words taught to search, every one scoped to a space tag. No query, row or
 * index involves an account.
 */

export async function listWords(db: D1Database, space: string): Promise<StoredWord[]> {
  const { results } = await db
    .prepare('SELECT id, meta FROM search_words WHERE space = ? ORDER BY id')
    .bind(space)
    .all<StoredWord>();
  return results;
}

export async function countWords(db: D1Database, space: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM search_words WHERE space = ?')
    .bind(space)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function hasWord(db: D1Database, space: string, id: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS found FROM search_words WHERE space = ? AND id = ?')
    .bind(space, id)
    .first<{ found: number }>();
  return row !== null;
}

/** Saves a word, new or changed. */
export async function putWord(db: D1Database, space: string, word: StoredWord) {
  await db
    .prepare(
      `INSERT INTO search_words (space, id, meta) VALUES (?, ?, ?)
       ON CONFLICT (space, id) DO UPDATE SET meta = excluded.meta`,
    )
    .bind(space, word.id, word.meta)
    .run();
}

/** Returns false if the word isn't in the space. */
export async function deleteWord(db: D1Database, space: string, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM search_words WHERE space = ? AND id = ?')
    .bind(space, id)
    .run();
  return result.meta.changes === 1;
}

export async function deleteAllWords(db: D1Database, space: string): Promise<void> {
  await db.prepare('DELETE FROM search_words WHERE space = ?').bind(space).run();
}
