-- Devices: each session gets a public id (so a device can be signed out without its token
-- hash ever leaving the server), a coarse label like "Chrome on Android", and when it was
-- last used, to the hour. Nothing here says which password opened which space: a login
-- with any slot starts the same kind of session.

ALTER TABLE sessions ADD COLUMN id TEXT;

ALTER TABLE sessions ADD COLUMN device TEXT NOT NULL DEFAULT '';

ALTER TABLE sessions ADD COLUMN device_kind TEXT NOT NULL DEFAULT 'computer';

ALTER TABLE sessions ADD COLUMN last_active INTEGER NOT NULL DEFAULT 0;

UPDATE sessions SET id = lower(hex(randomblob(16))), last_active = created_at;

CREATE UNIQUE INDEX sessions_by_id ON sessions (id);
