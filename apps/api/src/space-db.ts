import type { PhotoPart, StoredAlbum, StoredPhoto, StoredProfilePhoto } from '@arcafold/types';

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
  sealed_for_owner: number;
  sealed_for_album: string | null;
}

function toPhoto(row: PhotoRow): StoredPhoto {
  const photo: StoredPhoto = {
    id: row.id,
    meta: row.meta,
    thumbSize: row.thumb_size,
    fullSize: row.full_size,
  };
  if (row.sealed_for_owner === 1) photo.sealedForOwner = true;
  if (row.sealed_for_album !== null) photo.sealedForAlbum = row.sealed_for_album;
  return photo;
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
      `SELECT id, meta, thumb_size, full_size, pending_since, sealed_for_owner, sealed_for_album FROM photos
        WHERE space = ? AND id > ? AND pending_since IS NULL AND trashed = 0
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
      'SELECT id, meta, thumb_size, full_size, pending_since, sealed_for_owner, sealed_for_album FROM photos WHERE space = ? AND id = ?',
    )
    .bind(space, id)
    .first<PhotoRow>();
  return row ? { ...toPhoto(row), pending: row.pending_since !== null } : null;
}

/** Who a new photo's metadata is sealed for, when it isn't the space's records key. */
export type SealedFor = { owner: true } | { album: string } | null;

/**
 * Starts an upload. Returns false if the id is taken (in any space). `sealedFor` marks a
 * photo a phone added with an upload-only token (`owner`), or one someone given one album
 * added to it (`album`).
 */
export async function insertPendingPhoto(
  db: D1Database,
  space: string,
  photo: StoredPhoto,
  now: number,
  sealedFor: SealedFor = null,
): Promise<boolean> {
  const forOwner = sealedFor !== null && 'owner' in sealedFor ? 1 : 0;
  const forAlbum = sealedFor !== null && 'album' in sealedFor ? sealedFor.album : null;
  const result = await db
    .prepare(
      `INSERT INTO photos
         (id, space, meta, thumb_size, full_size, pending_since, sealed_for_owner, sealed_for_album)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    )
    .bind(photo.id, space, photo.meta, photo.thumbSize, photo.fullSize, now, forOwner, forAlbum)
    .run();
  return result.meta.changes === 1;
}

/**
 * Commits an upload whose files are there at its declared sizes. Returns false if nothing was
 * committed: the photo is missing, already committed, or the sizes don't match.
 */
export async function commitPhoto(
  db: D1Database,
  space: string,
  id: string,
  sizes: { thumbSize: number; fullSize: number },
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE photos SET pending_since = NULL
        WHERE space = ? AND id = ? AND pending_since IS NOT NULL
          AND thumb_size = ? AND full_size = ?`,
    )
    .bind(space, id, sizes.thumbSize, sizes.fullSize)
    .run();
  return result.meta.changes === 1;
}

/** Which of these photos are committed in this space: the ones a thumbnail batch may return. */
export async function committedPhotoIds(
  db: D1Database,
  space: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { results } = await db
    .prepare(
      `SELECT id FROM photos WHERE space = ? AND pending_since IS NULL
          AND id IN (${ids.map(() => '?').join(', ')})`,
    )
    .bind(space, ...ids)
    .all<{ id: string }>();
  return new Set(results.map((row) => row.id));
}

/** A photo row's id and the bytes it holds (both files), for deleting it. */
export interface PhotoSize {
  id: string;
  size: number;
}

/** Served by the photos_pending index, so it never reads the space's finished photos. */
export const STALE_PENDING_SQL =
  'SELECT id, thumb_size + full_size AS size FROM photos WHERE space = ? AND pending_since < ? LIMIT 100';

/** This space's uploads that started before `before` and never finished. */
export async function stalePendingPhotos(
  db: D1Database,
  space: string,
  before: number,
): Promise<PhotoSize[]> {
  const { results } = await db.prepare(STALE_PENDING_SQL).bind(space, before).all<PhotoSize>();
  return results;
}

/** The space's photos in Recently deleted after the cursor, in id order. */
export async function listTrashedPhotos(
  db: D1Database,
  space: string,
  after: string,
  limit: number,
): Promise<StoredPhoto[]> {
  const { results } = await db
    .prepare(
      `SELECT id, meta, thumb_size, full_size, pending_since, sealed_for_owner, sealed_for_album FROM photos
        WHERE space = ? AND trashed = 1 AND id > ?
        ORDER BY id LIMIT ?`,
    )
    .bind(space, after, limit)
    .all<PhotoRow>();
  return results.map(toPhoto);
}

/**
 * Moves committed photos into Recently deleted (`trashed` true) or back out, replacing their
 * sealed metadata in the same statement. Returns the ids this call moved: photos already
 * there, still uploading or not in this space are left as they are.
 */
export async function setPhotosTrashed(
  db: D1Database,
  space: string,
  photos: readonly { id: string; meta: string }[],
  trashed: boolean,
): Promise<string[]> {
  const results = await db.batch(
    photos.map((photo) =>
      db
        .prepare(
          `UPDATE photos SET meta = ?, trashed = ?, sealed_for_owner = 0, sealed_for_album = NULL
            WHERE space = ? AND id = ? AND pending_since IS NULL AND trashed = ?`,
        )
        .bind(photo.meta, trashed ? 1 : 0, space, photo.id, trashed ? 0 : 1),
    ),
  );
  return photos.filter((_, index) => results[index]?.meta.changes === 1).map((photo) => photo.id);
}

/**
 * Replaces a photo's sealed metadata, which is then sealed the usual way (an owner opening a
 * photo a phone or an album editor added clears `sealed_for_owner` or `sealed_for_album`). Returns false if the photo isn't
 * a committed photo in this space.
 */
export async function updatePhotoMeta(
  db: D1Database,
  space: string,
  id: string,
  meta: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE photos SET meta = ?, sealed_for_owner = 0, sealed_for_album = NULL
        WHERE space = ? AND id = ? AND pending_since IS NULL`,
    )
    .bind(meta, space, id)
    .run();
  return result.meta.changes === 1;
}

/**
 * Deletes photo rows, and takes them out of shared albums. Returns the ones this call
 * deleted (not already gone).
 */
export async function deletePhotoRows<T extends { id: string }>(
  db: D1Database,
  space: string,
  photos: readonly T[],
): Promise<T[]> {
  if (photos.length === 0) return [];
  // A deleted photo also leaves every shared album that listed it.
  const results = await db.batch([
    ...photos.map((photo) =>
      db.prepare('DELETE FROM photos WHERE space = ? AND id = ?').bind(space, photo.id),
    ),
    ...photos.map((photo) =>
      db.prepare('DELETE FROM album_items WHERE photo = ? AND space = ?').bind(photo.id, space),
    ),
    ...photos.map((photo) =>
      db.prepare('DELETE FROM album_removed WHERE photo = ? AND space = ?').bind(photo.id, space),
    ),
  ]);
  return photos.filter((_, index) => results[index]?.meta.changes === 1);
}

/** Up to `limit` photos of a space, committed or not, for wiping it. */
export async function somePhotos(
  db: D1Database,
  space: string,
  limit: number,
): Promise<PhotoSize[]> {
  const { results } = await db
    .prepare('SELECT id, thumb_size + full_size AS size FROM photos WHERE space = ? LIMIT ?')
    .bind(space, limit)
    .all<PhotoSize>();
  return results;
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

/**
 * Adds an album, unless the space already has `cap` (counted in the same statement, so
 * requests at the same moment can't pass it). Returns false if the id is taken (in any
 * space) or the cap is reached.
 */
export async function insertAlbum(
  db: D1Database,
  space: string,
  album: StoredAlbum,
  cap: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO albums (id, space, meta)
       SELECT ?1, ?2, ?3
        WHERE (SELECT COUNT(*) FROM albums WHERE space = ?2) < ?4
       ON CONFLICT (id) DO NOTHING`,
    )
    .bind(album.id, space, album.meta, cap)
    .run();
  return result.meta.changes === 1;
}

/** Replaces an album's sealed metadata (its title). Returns false if it isn't in the space. */
export async function updateAlbumMeta(
  db: D1Database,
  space: string,
  id: string,
  meta: string,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE albums SET meta = ? WHERE id = ? AND space = ?')
    .bind(meta, id, space)
    .run();
  return result.meta.changes === 1;
}

/** Deletes one album; its photos stay. Returns false if it isn't in the space. */
export async function deleteAlbum(db: D1Database, space: string, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM albums WHERE id = ? AND space = ?')
    .bind(id, space)
    .run();
  return result.meta.changes === 1;
}

export async function deleteAlbums(db: D1Database, space: string): Promise<void> {
  await db.prepare('DELETE FROM albums WHERE space = ?').bind(space).run();
}

/** How many photo rows a space has, committed or not. */
export async function countPhotos(db: D1Database, space: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM photos WHERE space = ?')
    .bind(space)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function findProfilePhoto(
  db: D1Database,
  space: string,
): Promise<StoredProfilePhoto | null> {
  return db
    .prepare('SELECT id, meta, image FROM profile_photos WHERE space = ?')
    .bind(space)
    .first<StoredProfilePhoto>();
}

/**
 * Sets a space's profile photo and returns the bytes the one it replaced held (0 if none).
 * A batch runs as one transaction, so of two replacements at once each sees the other's.
 */
export async function replaceProfilePhoto(
  db: D1Database,
  space: string,
  photo: StoredProfilePhoto,
  size: number,
): Promise<number> {
  const [previous] = await db.batch([
    db.prepare('SELECT size FROM profile_photos WHERE space = ?').bind(space),
    db
      .prepare(
        `INSERT INTO profile_photos (space, id, meta, image, size) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (space) DO UPDATE SET
           id = excluded.id, meta = excluded.meta, image = excluded.image, size = excluded.size`,
      )
      .bind(space, photo.id, photo.meta, photo.image, size),
  ]);
  const row = previous?.results[0] as { size: number } | undefined;
  return row?.size ?? 0;
}

/** Removes a space's profile photo and returns the bytes it held (0 if there was none). */
export async function deleteProfilePhoto(db: D1Database, space: string): Promise<number> {
  const row = await db
    .prepare('DELETE FROM profile_photos WHERE space = ? RETURNING size')
    .bind(space)
    .first<{ size: number }>();
  return row?.size ?? 0;
}
