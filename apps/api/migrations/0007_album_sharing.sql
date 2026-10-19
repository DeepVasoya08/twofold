-- Sharing one album with someone, instead of a whole library.
--
-- A shared album has a key of its own, made on the device. `albums.shared_meta` is the album's
-- title sealed under it, and `album_items` holds, for each photo in a shared album, the
-- photo's details (its file key, type, size and date) sealed under it too. Someone the album
-- is shared with gets a member row scoped to that album (`members.album`) and the album key,
-- never the space's records key, so they can open only that album's photos.
--
-- For shared albums only, the server can see which photo rows are in the album. Albums that
-- aren't shared have no rows here, and their photos still name them only inside sealed
-- metadata.

ALTER TABLE members ADD COLUMN album TEXT;

ALTER TABLE albums ADD COLUMN shared_meta TEXT;

CREATE TABLE album_items (
  album TEXT NOT NULL,
  photo TEXT NOT NULL,
  space TEXT NOT NULL,
  meta TEXT NOT NULL,
  PRIMARY KEY (album, photo)
);

CREATE INDEX album_items_by_photo ON album_items (photo);

CREATE INDEX album_items_by_space ON album_items (space);

CREATE INDEX members_by_album ON members (album) WHERE album IS NOT NULL;
