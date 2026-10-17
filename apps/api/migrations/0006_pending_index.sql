-- Finds a space's abandoned uploads without reading every photo in the space. Starting an
-- upload looks for them first, so without this each upload read the whole space's rows.
-- Only unfinished uploads are in it, so it stays tiny.

CREATE INDEX photos_pending ON photos (space, pending_since) WHERE pending_since IS NOT NULL;
