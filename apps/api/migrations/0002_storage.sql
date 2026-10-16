-- Photo storage.
--
-- Rows belong to a space, not to an account: `space` is the SHA-256 of the space's access
-- token, which only a device holding the space's key slot knows. Nothing here links a space
-- to an account, so the database can't show whose photos these are or whether an account
-- has a private space. Metadata (dates, favorites, albums, titles, and each photo's own key)
-- is sealed on the device; the server sees only sizes.
--
-- There are deliberately no timestamps, except `pending_since` on uploads that haven't
-- finished, so abandoned ones can be cleaned up. It is cleared on commit.

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  meta TEXT NOT NULL,
  thumb_size INTEGER NOT NULL,
  full_size INTEGER NOT NULL,
  pending_since INTEGER
);

CREATE INDEX photos_by_space ON photos (space, id);

CREATE TABLE albums (
  id TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  meta TEXT NOT NULL
);

CREATE INDEX albums_by_space ON albums (space, id);
