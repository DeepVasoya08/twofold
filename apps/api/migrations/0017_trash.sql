-- Recently deleted.
--
-- Deleting a photo first moves it here: `trashed` hides it from the space's photo list and
-- from shared albums, and the owner or a member who can edit can restore it. When it was
-- deleted is sealed in the photo's own metadata, never stored here (the table keeps no
-- timestamps), and the device deletes it for good once 30 days have passed. Trashed photos
-- keep counting against storage until then.

ALTER TABLE photos ADD COLUMN trashed INTEGER NOT NULL DEFAULT 0;

-- Lists a space's deleted photos without reading the rest. Only trashed rows are in it.
CREATE INDEX photos_trashed ON photos (space, id) WHERE trashed = 1;
