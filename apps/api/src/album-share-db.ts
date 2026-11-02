import type { StoredAlbum, StoredPhoto } from '@arcafold/types';

/**
 * Shared album queries. A shared album's title (`albums.shared_meta`) and its photos' details
 * (`album_items`) are sealed under the album's own key. Like every storage query, each one is
 * scoped to a space tag and never involves an account.
 */

/** Starts sharing an album, or replaces its sealed title. False if it isn't in the space. */
export async function setAlbumShared(
  db: D1Database,
  space: string,
  album: string,
  meta: string,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE albums SET shared_meta = ? WHERE id = ? AND space = ?')
    .bind(meta, album, space)
    .run();
  return result.meta.changes === 1;
}

/** Whether the album is in the space and shared. */
export async function isAlbumShared(
  db: D1Database,
  space: string,
  album: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS found FROM albums WHERE id = ? AND space = ? AND shared_meta IS NOT NULL')
    .bind(album, space)
    .first<{ found: number }>();
  return row !== null;
}

/**
 * Forgets an album's sharing: its sealed title and items, and everyone it was shared with,
 * whose tokens stop working at once. Used to stop sharing, and when the album is deleted.
 */
export async function deleteAlbumSharing(
  db: D1Database,
  space: string,
  album: string,
): Promise<void> {
  await db.batch([
    db
      .prepare('UPDATE albums SET shared_meta = NULL WHERE id = ? AND space = ?')
      .bind(album, space),
    db.prepare('DELETE FROM album_items WHERE album = ? AND space = ?').bind(album, space),
    db.prepare('DELETE FROM members WHERE album = ? AND space = ?').bind(album, space),
  ]);
}

/**
 * Adds a photo to what a shared album lists, or replaces its sealed details. Only a committed
 * photo of the same space can go in, and only while the album is shared; false otherwise.
 */
export async function putAlbumItem(
  db: D1Database,
  space: string,
  item: { album: string; photo: string; meta: string },
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO album_items (album, photo, space, meta)
       SELECT ?1, ?2, ?3, ?4
        WHERE EXISTS (SELECT 1 FROM albums
                       WHERE id = ?1 AND space = ?3 AND shared_meta IS NOT NULL)
          AND EXISTS (SELECT 1 FROM photos
                       WHERE id = ?2 AND space = ?3 AND pending_since IS NULL)
       ON CONFLICT (album, photo) DO UPDATE SET meta = excluded.meta
        WHERE album_items.space = excluded.space`,
    )
    .bind(item.album, item.photo, space, item.meta)
    .run();
  return result.meta.changes === 1;
}

export async function deleteAlbumItem(
  db: D1Database,
  space: string,
  album: string,
  photo: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM album_items WHERE album = ? AND photo = ? AND space = ?')
    .bind(album, photo, space)
    .run();
}

/** Which photos a shared album lists, so the device can bring it up to date. */
export async function albumItemIds(
  db: D1Database,
  space: string,
  album: string,
): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT photo FROM album_items WHERE album = ? AND space = ? ORDER BY photo')
    .bind(album, space)
    .all<{ photo: string }>();
  return results.map((row) => row.photo);
}

// ---------------------------------------------------------------------------------------
// What someone an album is shared with sees: the album, and its photos with their details
// sealed under the album key in place of the space's own records.

/** The shared album, with its title sealed under the album key, or nothing if not shared. */
export async function sharedAlbumList(
  db: D1Database,
  space: string,
  album: string,
): Promise<StoredAlbum[]> {
  const row = await db
    .prepare(
      'SELECT id, shared_meta AS meta FROM albums WHERE id = ? AND space = ? AND shared_meta IS NOT NULL',
    )
    .bind(album, space)
    .first<StoredAlbum>();
  return row ? [row] : [];
}

interface ItemRow {
  id: string;
  meta: string;
  thumb_size: number;
  full_size: number;
}

/**
 * The shared album's committed photos after the cursor, in id order. Photos in Recently
 * deleted are left out until they're restored.
 */
export async function listSharedAlbumPhotos(
  db: D1Database,
  space: string,
  album: string,
  after: string,
  limit: number,
): Promise<StoredPhoto[]> {
  const { results } = await db
    .prepare(
      `SELECT photos.id AS id, album_items.meta AS meta, thumb_size, full_size
         FROM album_items JOIN photos ON photos.id = album_items.photo
        WHERE album_items.album = ? AND album_items.space = ? AND photos.space = album_items.space
          AND photos.pending_since IS NULL AND photos.trashed = 0 AND photos.id > ?
        ORDER BY photos.id LIMIT ?`,
    )
    .bind(album, space, after, limit)
    .all<ItemRow>();
  return results.map((row) => ({
    id: row.id,
    meta: row.meta,
    thumbSize: row.thumb_size,
    fullSize: row.full_size,
  }));
}

/**
 * Which of these photos the shared album lists (and aren't in Recently deleted): the only
 * files its people may download.
 */
export async function sharedAlbumPhotoIds(
  db: D1Database,
  space: string,
  album: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { results } = await db
    .prepare(
      `SELECT photo FROM album_items JOIN photos ON photos.id = album_items.photo
        WHERE album_items.album = ? AND album_items.space = ? AND photos.space = album_items.space
          AND photos.pending_since IS NULL AND photos.trashed = 0
          AND album_items.photo IN (${ids.map(() => '?').join(', ')})`,
    )
    .bind(album, space, ...ids)
    .all<{ photo: string }>();
  return new Set(results.map((row) => row.photo));
}
