-- People a folder is shared with as "Add and edit" can make, rename, move and delete what's
-- inside it. They don't have the space's records key, so they can't change the owner's own
-- records: each change is kept here, sealed under the folder's key, until the owner's device
-- (or a library member who can edit) opens it, makes the change in the space's own records
-- and lets the server forget it. Until then, everyone given the folder applies the changes
-- still waiting on top of what it lists.
--
-- Like `album_removed`, a row names only the shared folder (an album row), the space and a
-- random id; what the change is stays sealed. `seq` keeps the order the changes were made in.

CREATE TABLE folder_edits (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  album TEXT NOT NULL,
  space TEXT NOT NULL,
  meta TEXT NOT NULL
);

CREATE INDEX folder_edits_by_album ON folder_edits (album, space);

CREATE INDEX folder_edits_by_space ON folder_edits (space);
