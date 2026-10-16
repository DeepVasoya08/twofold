-- Storage quota: the encrypted bytes each account has uploaded and not deleted, across
-- every space it uses. Only the total is kept, never which photos or spaces it's made of.

ALTER TABLE accounts ADD COLUMN stored_bytes INTEGER NOT NULL DEFAULT 0;
