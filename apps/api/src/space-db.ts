import type { PhotoPart, StoredAlbum, StoredPhoto } from '@twofold/types';

/**
 * Storage queries. Every query is scoped to a space tag (the SHA-256 of the space's access
 * token); no query, row or index involves an account.
 */

interface PhotoRow {
  id: string;
  meta: string;
  thumb_size: number;
  full_size: number;
  pending_since: number | null;
}

function toPhoto(row: PhotoRow): StoredPhoto {
  return { id: row.id, meta: row.meta, thumbSize: row.thumb_size, fullSize: row.full_size };
}

/** A photo row, committed or still uploading. */
export interface PhotoRecord extends StoredPhoto {
  pending: boolean;
}

/** R2 object key of one of a photo's files. Photo ids are random, so these are too. */
export function objectKey(photoId: string, part: PhotoPart): string {
  return `photos/${photoId}/${part}`;
}

export function objectKeys(photoId: string): string[] {
  return [objectKey(photoId, 'thumb'), objectKey(photoId, 'full')];
}

/** Committed photos after the cursor, in id order. */
export async function listPhotos(
  db: D1Database,
  space: string,
  after: string,
  limit: number,
): Promise<StoredPhoto[]> {
  const { results } = await db
    .prepare(
      `SELECT id, meta, thumb_size, full_size, pending_since FROM photos
        WHERE space = ? AND id > ? AND pending_since IS NULL
        ORDER BY id LIMIT ?`,
    )
    .bind(space, after, limit)
    .all<PhotoRow>();
  return results.map(toPhoto);
}

export async function findPhoto(
  db: D1Database,
  space: string,
  id: string,
): Promise<PhotoRecord | null> {
  const row = await db
    .prepare(
      'SELECT id, meta, thumb_size, full_size, pending_since FROM photos WHERE space = ? AND id = ?',
    )
    .bind(space, id)
    .first<PhotoRow>();
  return row ? { ...toPhoto(row), pending: row.pending_since !== null } : null;
}

/** Starts an upload. Returns false if the id is taken (in any space). */
export async function insertPendingPhoto(
  db: D1Database,
  space: string,
  photo: StoredPhoto,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO photos (id, space, meta, thumb_size, full_size, pending_since)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    )
    .bind(photo.id, space, photo.meta, photo.thumbSize, photo.fullSize, now)
    .run();
  return result.meta.changes === 1;
}

export async function commitPhoto(db: D1Database, space: string, id: string): Promise<void> {
  await db
    .prepare('UPDATE photos SET pending_since = NULL WHERE space = ? AND id = ?')
    .bind(space, id)
    .run();
}

/** Ids of this space's uploads that started before `before` and never finished. */
export async function stalePendingPhotos(
  db: D1Database,
  space: string,
  before: number,
): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT id FROM photos WHERE space = ? AND pending_since < ? LIMIT 100')
    .bind(space, before)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

/** Returns false if the photo isn't a committed photo in this space. */
export async function updatePhotoMeta(
  db: D1Database,
  space: string,
  id: string,
  meta: string,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE photos SET meta = ? WHERE space = ? AND id = ? AND pending_since IS NULL')
    .bind(meta, space, id)
    .run();
  return result.meta.changes === 1;
}

export async function deletePhotoRows(
  db: D1Database,
  space: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(
    ids.map((id) => db.prepare('DELETE FROM photos WHERE space = ? AND id = ?').bind(space, id)),
  );
}

/** Up to `limit` photo ids of a space, committed or not, for wiping it. */
export async function somePhotoIds(
  db: D1Database,
  space: string,
  limit: number,
): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT id FROM photos WHERE space = ? LIMIT ?')
    .bind(space, limit)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

export async function listAlbums(db: D1Database, space: string): Promise<StoredAlbum[]> {
  const { results } = await db
    .prepare('SELECT id, meta FROM albums WHERE space = ? ORDER BY id')
    .bind(space)
    .all<StoredAlbum>();
  return results;
}

export async function countAlbums(db: D1Database, space: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM albums WHERE space = ?')
    .bind(space)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/** Returns false if the id is taken (in any space). */
export async function insertAlbum(
  db: D1Database,
  space: string,
  album: StoredAlbum,
): Promise<boolean> {
  const result = await db
    .prepare('INSERT INTO albums (id, space, meta) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING')
    .bind(album.id, space, album.meta)
    .run();
  return result.meta.changes === 1;
}

export async function deleteAlbums(db: D1Database, space: string): Promise<void> {
  await db.prepare('DELETE FROM albums WHERE space = ?').bind(space).run();
}
