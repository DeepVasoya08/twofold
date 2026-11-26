-- Verified emails. An account's email is used to reach its owner (codes, sign-in notices),
-- never to unlock anything: there is no password reset, only the recovery key.

ALTER TABLE accounts ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;

-- Pending email codes. `scope` is an HMAC (keyed with a server secret) of what the code is
-- for, and `tag` an HMAC of the code bound to the address it went to, so a copy of this
-- table alone can't be used to guess codes or read addresses. A row is deleted once its
-- code is used, and rows of a deleted account go with it.
CREATE TABLE email_codes (
  scope TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts (id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL,
  -- Emails sent for this scope since `sends_since`, to cap how many one account can send.
  sends INTEGER NOT NULL,
  sends_since INTEGER NOT NULL
);

CREATE INDEX email_codes_by_account ON email_codes (account_id);
