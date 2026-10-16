-- Accounts, sessions and login throttling.
--
-- The keyring column is JSON: { salt, kdf, slots[3], verifiers[3] }. Every account has all
-- three slots and verifiers from sign-up; unused ones are random bytes. There is
-- deliberately no per-slot column or timestamp, so nothing here shows which slots are in
-- use or which one changed last.

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  keyring TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- Only a SHA-256 of each session token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_by_account ON sessions (account_id);

-- Failed login attempts per email, in a fixed window.
CREATE TABLE login_failures (
  email TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  failures INTEGER NOT NULL
);
