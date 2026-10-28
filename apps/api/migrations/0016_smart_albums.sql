-- Smart albums: searches saved as albums, which fill themselves as photos are looked at.
-- Each is sealed on the device under a key members never get, like taught words.
--
-- Like photos, rows belong to a space tag and never to an account.

CREATE TABLE smart_albums (
  space TEXT NOT NULL,
  id TEXT NOT NULL,
  meta TEXT NOT NULL,
  PRIMARY KEY (space, id)
);
