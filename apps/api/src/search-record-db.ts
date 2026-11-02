import type { StoredWord } from '@arcafold/types';

/**
 * Queries for search's sealed records: words taught to it and smart albums. Every query is
 * scoped to a space tag; no query, row or index involves an account.
 */
export type SearchRecordTable = 'search_words' | 'smart_albums';

/** A sealed record: its id and its sealed meta. */
type StoredRecord = StoredWord;

export async function listRecords(
  db: D1Database,
  table: SearchRecordTable,
  space: string,
): Promise<StoredRecord[]> {
  const { results } = await db
    .prepare(`SELECT id, meta FROM ${table} WHERE space = ? ORDER BY id`)
    .bind(space)
    .all<StoredRecord>();
  return results;
}

export async function countRecords(
  db: D1Database,
  table: SearchRecordTable,
  space: string,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE space = ?`)
    .bind(space)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function hasRecord(
  db: D1Database,
  table: SearchRecordTable,
  space: string,
  id: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS found FROM ${table} WHERE space = ? AND id = ?`)
    .bind(space, id)
    .first<{ found: number }>();
  return row !== null;
}

/** Saves a record, new or changed. */
export async function putRecord(
  db: D1Database,
  table: SearchRecordTable,
  space: string,
  record: StoredRecord,
) {
  await db
    .prepare(
      `INSERT INTO ${table} (space, id, meta) VALUES (?, ?, ?)
       ON CONFLICT (space, id) DO UPDATE SET meta = excluded.meta`,
    )
    .bind(space, record.id, record.meta)
    .run();
}

/** Returns false if the record isn't in the space. */
export async function deleteRecord(
  db: D1Database,
  table: SearchRecordTable,
  space: string,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM ${table} WHERE space = ? AND id = ?`)
    .bind(space, id)
    .run();
  return result.meta.changes === 1;
}

/** Deletes every taught word and smart album of a space. */
export async function deleteAllRecords(db: D1Database, space: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM search_words WHERE space = ?').bind(space),
    db.prepare('DELETE FROM smart_albums WHERE space = ?').bind(space),
  ]);
}
