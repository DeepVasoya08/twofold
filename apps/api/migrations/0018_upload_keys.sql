-- Upload-only keys, so a phone can back up photos while Arcafold is locked.
--
-- `upload_keys` holds one sealed owner record per space: the secret half of the space's
-- upload key pair, under a key only the owner has. Phones keep the public half.
--
-- `upload_tokens` maps the SHA-256 of each phone's upload token to the space it adds photos
-- to. Such a token can only start, upload and commit photos: it can't list, read, change or
-- delete anything. The owner can revoke one phone without touching the others. Like
-- `members`, rows name only the space tag and keep no timestamps.
--
-- A photo a phone added this way has `sealed_for_owner` set: its metadata is sealed to the
-- upload key, so only the owner can open it. The owner's device opens it, seals it again
-- under the records key and saves it, which clears the flag.

CREATE TABLE upload_keys (
  space TEXT PRIMARY KEY,
  meta TEXT NOT NULL
);

CREATE TABLE upload_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  space TEXT NOT NULL
);

CREATE INDEX upload_tokens_by_space ON upload_tokens (space, id);

ALTER TABLE photos ADD COLUMN sealed_for_owner INTEGER NOT NULL DEFAULT 0;
