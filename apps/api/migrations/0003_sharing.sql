-- Sharing.
--
-- A space is shared by giving someone a share token of their own and the space's records
-- key (never the space key). `members` maps the SHA-256 of each share token to the space it
-- opens, so the owner can revoke one person without touching anyone else. Its `meta` (who
-- the member is) is sealed under a key only the owner has.
--
-- `joined` holds, per space, the libraries that space has joined: sealed records with the
-- share token and records key, again under the owner's own key. A library joined from the
-- private space lives in the private space's rows, so nothing here links it to an account.
--
-- Invites are short-lived rendezvous rows for the key exchange (see docs/security.md). They
-- hold public keys and sealed messages only, are addressed by hashes, and are deleted when
-- the invite finishes, is cancelled, or expires.

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  space TEXT NOT NULL,
  meta TEXT NOT NULL
);

CREATE INDEX members_by_space ON members (space, id);

CREATE TABLE joined (
  id TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  meta TEXT NOT NULL
);

CREATE INDEX joined_by_space ON joined (space, id);

CREATE TABLE invites (
  handle_hash TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  commitment TEXT NOT NULL,
  joiner_key TEXT,
  inviter_key TEXT,
  hello TEXT,
  grant_box TEXT,
  expires_at INTEGER NOT NULL
);

CREATE INDEX invites_by_expiry ON invites (expires_at);
