import { randomBytes, sha256, toBase64Url } from '@arcafold/crypto/webcrypto';

/** Gives the space a new random stamp: something in it changed. */
export async function bumpStamp(db: D1Database, space: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO space_stamps (space, stamp) VALUES (?1, ?2)
       ON CONFLICT (space) DO UPDATE SET stamp = ?2`,
    )
    .bind(space, toBase64Url(randomBytes(16)))
    .run();
}

/** The space's stamp, or '' if nothing in it has changed since stamps began. */
export async function readStamp(db: D1Database, space: string): Promise<string> {
  const row = await db
    .prepare('SELECT stamp FROM space_stamps WHERE space = ?')
    .bind(space)
    .first<{ stamp: string }>();
  return row?.stamp ?? '';
}

export async function deleteStamp(db: D1Database, space: string): Promise<void> {
  await db.prepare('DELETE FROM space_stamps WHERE space = ?').bind(space).run();
}

/**
 * What someone given one album (or folder, or file) can see of it, boiled down to one value:
 * its shared record, what it lists, the changes waiting in it and what they may do. Worked
 * out from those rows each time rather than kept, so their stamp moves only when what they
 * see does, and says nothing about the rest of the space. Every sealed record starts with
 * its own random nonce, new each time it's sealed, so its first 32 characters show a change.
 */
export async function albumStamp(
  db: D1Database,
  space: string,
  album: string,
  member: string,
): Promise<string> {
  const [shared, items, edits, access] = await db.batch<{ part: string }>([
    db
      .prepare(
        `SELECT substr(shared_meta, 1, 32) AS part FROM albums
          WHERE space = ? AND id = ? AND shared_meta IS NOT NULL`,
      )
      .bind(space, album),
    db
      .prepare(
        `SELECT album_items.photo || substr(album_items.meta, 1, 32) AS part
           FROM album_items JOIN photos ON photos.id = album_items.photo
          WHERE album_items.album = ? AND album_items.space = ? AND photos.space = album_items.space
            AND photos.pending_since IS NULL AND photos.trashed = 0
          ORDER BY album_items.photo`,
      )
      .bind(album, space),
    db
      .prepare('SELECT id AS part FROM folder_edits WHERE album = ? AND space = ? ORDER BY seq')
      .bind(album, space),
    db.prepare('SELECT access AS part FROM members WHERE id = ? AND space = ?').bind(member, space),
  ]);
  const parts = [shared, items, edits, access].map((result) =>
    (result?.results ?? []).map((row) => row.part).join(','),
  );
  return toBase64Url(await sha256(new TextEncoder().encode(parts.join('|'))));
}
