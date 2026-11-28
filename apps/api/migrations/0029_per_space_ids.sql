-- Record ids are unique within their space, not across spaces (see apps/api/src/space-db.ts
-- and docs/security.md). Every table whose rows the device names by id is keyed by space and
-- id, so the same id can be used in two spaces, and adding a record can only ever say that
-- this space already has that id, never that some other space does.
--
-- Photo files in R2 are named by `photos.blob`, a random name the server picks for each
-- upload, so two spaces' photos with the same id never share a file. Rows from before keep
-- their id as their blob: their files are already named that way, and those ids were unique.
--
-- SQLite can't change a table's key in place, so each table is copied to a new one.

CREATE TABLE photos_new (
  id TEXT NOT NULL,
  space TEXT NOT NULL,
  meta TEXT NOT NULL,
  thumb_size INTEGER NOT NULL,
  full_size INTEGER NOT NULL,
  pending_since INTEGER,
  trashed INTEGER NOT NULL DEFAULT 0,
  sealed_for_owner INTEGER NOT NULL DEFAULT 0,
  sealed_for_album TEXT,
  blob TEXT NOT NULL UNIQUE,
  PRIMARY KEY (space, id)
);
INSERT INTO photos_new
  (id, space, meta, thumb_size, full_size, pending_since, trashed, sealed_for_owner,
   sealed_for_album, blob)
  SELECT id, space, meta, thumb_size, full_size, pending_since, trashed, sealed_for_owner,
         sealed_for_album, id
    FROM photos;
DROP TABLE photos;
ALTER TABLE photos_new RENAME TO photos;
CREATE INDEX photos_pending ON photos (space, pending_since) WHERE pending_since IS NOT NULL;
CREATE INDEX photos_trashed ON photos (space, id) WHERE trashed = 1;

CREATE TABLE albums_new (
  id TEXT NOT NULL,
  space TEXT NOT NULL,
  meta TEXT NOT NULL,
  shared_meta TEXT,
  PRIMARY KEY (space, id)
);
INSERT INTO albums_new (id, space, meta, shared_meta)
  SELECT id, space, meta, shared_meta FROM albums;
DROP TABLE albums;
ALTER TABLE albums_new RENAME TO albums;

CREATE TABLE album_items_new (
  album TEXT NOT NULL,
  photo TEXT NOT NULL,
  space TEXT NOT NULL,
  meta TEXT NOT NULL,
  PRIMARY KEY (space, album, photo)
);
INSERT INTO album_items_new (album, photo, space, meta)
  SELECT album, photo, space, meta FROM album_items;
DROP TABLE album_items;
ALTER TABLE album_items_new RENAME TO album_items;
CREATE INDEX album_items_by_photo ON album_items (space, photo);

CREATE TABLE album_removed_new (
  album TEXT NOT NULL,
  photo TEXT NOT NULL,
  space TEXT NOT NULL,
  PRIMARY KEY (space, album, photo)
);
INSERT INTO album_removed_new (album, photo, space)
  SELECT album, photo, space FROM album_removed;
DROP TABLE album_removed;
ALTER TABLE album_removed_new RENAME TO album_removed;
CREATE INDEX album_removed_by_photo ON album_removed (space, photo);

CREATE TABLE folder_edits_new (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  album TEXT NOT NULL,
  space TEXT NOT NULL,
  meta TEXT NOT NULL,
  UNIQUE (space, id)
);
INSERT INTO folder_edits_new (seq, id, album, space, meta)
  SELECT seq, id, album, space, meta FROM folder_edits;
DROP TABLE folder_edits;
ALTER TABLE folder_edits_new RENAME TO folder_edits;
CREATE INDEX folder_edits_by_album ON folder_edits (space, album);

CREATE TABLE joined_new (
  id TEXT NOT NULL,
  space TEXT NOT NULL,
  meta TEXT NOT NULL,
  PRIMARY KEY (space, id)
);
INSERT INTO joined_new (id, space, meta) SELECT id, space, meta FROM joined;
DROP TABLE joined;
ALTER TABLE joined_new RENAME TO joined;

-- A share token's hash stays unique across spaces: it is how the server finds the space.
CREATE TABLE members_new (
  id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  space TEXT NOT NULL,
  meta TEXT NOT NULL,
  album TEXT,
  access TEXT NOT NULL DEFAULT 'edit' CHECK (access IN ('view', 'edit')),
  PRIMARY KEY (space, id)
);
INSERT INTO members_new (id, token_hash, space, meta, album, access)
  SELECT id, token_hash, space, meta, album, access FROM members;
DROP TABLE members;
ALTER TABLE members_new RENAME TO members;
CREATE INDEX members_by_album ON members (space, album) WHERE album IS NOT NULL;

CREATE TABLE pending_invites_new (
  id TEXT NOT NULL,
  space TEXT NOT NULL,
  meta TEXT NOT NULL,
  PRIMARY KEY (space, id)
);
INSERT INTO pending_invites_new (id, space, meta) SELECT id, space, meta FROM pending_invites;
DROP TABLE pending_invites;
ALTER TABLE pending_invites_new RENAME TO pending_invites;

-- Like a share token's, an upload token's hash stays unique across spaces.
CREATE TABLE upload_tokens_new (
  id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  space TEXT NOT NULL,
  PRIMARY KEY (space, id)
);
INSERT INTO upload_tokens_new (id, token_hash, space) SELECT id, token_hash, space FROM upload_tokens;
DROP TABLE upload_tokens;
ALTER TABLE upload_tokens_new RENAME TO upload_tokens;
