-- Invites that don't need both people online at once.
--
-- An invite can now be opened from a link as well as typed as a code. The link's token is 128
-- random bits; like the code and the handle, only its SHA-256 is kept (`link_hash`). It names
-- the invite and nothing else.
--
-- `intro` is the inviter's name, sealed to the joiner's key, revealed together with the
-- inviter's key.
--
-- `pending_invites` holds, per space, the invites that space has in progress, on either side:
-- the invite's secret key and what it is for, sealed under the space owner's own key. Like
-- `members` and `joined`, rows are keyed by the space tag only and never name an account, so
-- an invite made from (or joined into) the private space is kept in the private space's rows.
-- Nothing links a row here to a row in `invites`.

ALTER TABLE invites ADD COLUMN link_hash TEXT;

ALTER TABLE invites ADD COLUMN intro TEXT;

CREATE UNIQUE INDEX invites_by_link ON invites (link_hash);

CREATE TABLE pending_invites (
  id TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  meta TEXT NOT NULL
);

CREATE INDEX pending_invites_by_space ON pending_invites (space, id);
