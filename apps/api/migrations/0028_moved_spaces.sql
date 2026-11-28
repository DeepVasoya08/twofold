-- Library ids that were moved away from (apps/api/src/space-move.ts). A new main password or
-- recovery key moves the main library to a new id, and the old id is kept here so the server
-- refuses it from then on: a browser tab still holding the old keys locks instead of adding
-- photos under an id nothing else reaches.
--
-- Only the old tag is kept. Nothing here says where the library went, whose it was, or when.
-- Every keyring change adds one (a change that moves nothing adds a random tag no library
-- uses), so the rows say no more than how many keyring changes there were.

CREATE TABLE moved_spaces (
  tag TEXT PRIMARY KEY
);
