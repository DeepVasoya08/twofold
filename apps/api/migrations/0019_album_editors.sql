-- People one album is shared with can be let add and remove photos ("Add and edit").
--
-- `members.access` now applies to album-scoped members too. Until now they were view-only
-- whatever the column said, and ones added before 0011 say 'edit', so every existing album
-- member is set to 'view': nobody gains anything from this migration.
--
-- A photo an album editor adds has `sealed_for_album` set to the album: its metadata is sealed
-- under that album's key, the only key they have. The owner's device (or a library member
-- who can edit) opens it with the album key, seals it again under the records key and saves
-- it, which clears the column, like `sealed_for_owner`.
--
-- When an album editor takes a photo out of the album, the server unlists it at once and
-- keeps its id in `album_removed`, so the owner's device can take the album out of the
-- photo's own sealed metadata (which only it can change) and doesn't list it again. The row
-- goes once that is done, or when the photo is listed again or deleted. Like `album_items`,
-- these rows name only the album, photo and space.

UPDATE members SET access = 'view' WHERE album IS NOT NULL;

ALTER TABLE photos ADD COLUMN sealed_for_album TEXT;

CREATE TABLE album_removed (
  album TEXT NOT NULL,
  photo TEXT NOT NULL,
  space TEXT NOT NULL,
  PRIMARY KEY (album, photo)
);

CREATE INDEX album_removed_by_space ON album_removed (space);

CREATE INDEX album_removed_by_photo ON album_removed (photo);
