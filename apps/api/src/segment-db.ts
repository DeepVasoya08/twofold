import type { StoredFaceSegment } from '@twofold/types';

/**
 * Segment queries shared by face results and search vectors: sealed batches of results,
 * every query scoped to a space tag. No query, row or index involves an account.
 */
export type SegmentTable = 'face_segments' | 'search_segments';

/** Segments after the cursor, in id order. */
export async function listSegments(
  db: D1Database,
  table: SegmentTable,
  space: string,
  after: string,
  limit: number,
): Promise<StoredFaceSegment[]> {
  const { results } = await db
    .prepare(`SELECT id, data FROM ${table} WHERE space = ? AND id > ? ORDER BY id LIMIT ?`)
    .bind(space, after, limit)
    .all<StoredFaceSegment>();
  return results;
}

export async function countSegments(
  db: D1Database,
  table: SegmentTable,
  space: string,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE space = ?`)
    .bind(space)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/** Returns false if the space already has a segment with this id. */
export async function insertSegment(
  db: D1Database,
  table: SegmentTable,
  space: string,
  segment: StoredFaceSegment,
  size: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO ${table} (space, id, data, size) VALUES (?, ?, ?, ?)
       ON CONFLICT (space, id) DO NOTHING`,
    )
    .bind(space, segment.id, segment.data, size)
    .run();
  return result.meta.changes === 1;
}

/** Deletes segments and returns the bytes the ones this call deleted held. */
export async function deleteSegments(
  db: D1Database,
  table: SegmentTable,
  space: string,
  ids: readonly string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const results = await db.batch(
    ids.map((id) =>
      db.prepare(`DELETE FROM ${table} WHERE space = ? AND id = ? RETURNING size`).bind(space, id),
    ),
  );
  return results.reduce(
    (total, result) => total + ((result.results[0] as { size: number } | undefined)?.size ?? 0),
    0,
  );
}

/** Deletes every segment of a space, and returns the bytes they held. */
export async function deleteAllSegments(
  db: D1Database,
  table: SegmentTable,
  space: string,
): Promise<number> {
  const { results } = await db
    .prepare(`DELETE FROM ${table} WHERE space = ? RETURNING size`)
    .bind(space)
    .all<{ size: number }>();
  return results.reduce((total, row) => total + row.size, 0);
}
