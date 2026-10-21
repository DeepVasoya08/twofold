import type { StoredFaceSegment, StoredPerson } from '@twofold/types';

/**
 * People queries: sealed face segments and people, every query scoped to a space tag. No
 * query, row or index involves an account.
 */

/** Segments after the cursor, in id order. */
export async function listFaceSegments(
  db: D1Database,
  space: string,
  after: string,
  limit: number,
): Promise<StoredFaceSegment[]> {
  const { results } = await db
    .prepare('SELECT id, data FROM face_segments WHERE space = ? AND id > ? ORDER BY id LIMIT ?')
    .bind(space, after, limit)
    .all<StoredFaceSegment>();
  return results;
}

export async function countFaceSegments(db: D1Database, space: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM face_segments WHERE space = ?')
    .bind(space)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/** Returns false if the space already has a segment with this id. */
export async function insertFaceSegment(
  db: D1Database,
  space: string,
  segment: StoredFaceSegment,
  size: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO face_segments (space, id, data, size) VALUES (?, ?, ?, ?)
       ON CONFLICT (space, id) DO NOTHING`,
    )
    .bind(space, segment.id, segment.data, size)
    .run();
  return result.meta.changes === 1;
}

/** Deletes segments and returns the bytes the ones this call deleted held. */
export async function deleteFaceSegments(
  db: D1Database,
  space: string,
  ids: readonly string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const results = await db.batch(
    ids.map((id) =>
      db
        .prepare('DELETE FROM face_segments WHERE space = ? AND id = ? RETURNING size')
        .bind(space, id),
    ),
  );
  return results.reduce(
    (total, result) => total + ((result.results[0] as { size: number } | undefined)?.size ?? 0),
    0,
  );
}

export async function listPeople(db: D1Database, space: string): Promise<StoredPerson[]> {
  const { results } = await db
    .prepare('SELECT id, meta FROM people WHERE space = ? ORDER BY id')
    .bind(space)
    .all<StoredPerson>();
  return results;
}

export async function countPeople(db: D1Database, space: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM people WHERE space = ?')
    .bind(space)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function hasPerson(db: D1Database, space: string, id: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS found FROM people WHERE space = ? AND id = ?')
    .bind(space, id)
    .first<{ found: number }>();
  return row !== null;
}

/** Saves a person, new or changed. */
export async function putPerson(db: D1Database, space: string, person: StoredPerson) {
  await db
    .prepare(
      `INSERT INTO people (space, id, meta) VALUES (?, ?, ?)
       ON CONFLICT (space, id) DO UPDATE SET meta = excluded.meta`,
    )
    .bind(space, person.id, person.meta)
    .run();
}

/** Returns false if the person isn't in the space. */
export async function deletePerson(db: D1Database, space: string, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM people WHERE space = ? AND id = ?')
    .bind(space, id)
    .run();
  return result.meta.changes === 1;
}

/** Deletes every segment and person of a space, and returns the bytes the segments held. */
export async function deleteFaceData(db: D1Database, space: string): Promise<number> {
  const [segments] = await db.batch([
    db.prepare('DELETE FROM face_segments WHERE space = ? RETURNING size').bind(space),
    db.prepare('DELETE FROM people WHERE space = ?').bind(space),
  ]);
  return ((segments?.results ?? []) as { size: number }[]).reduce(
    (total, row) => total + row.size,
    0,
  );
}
