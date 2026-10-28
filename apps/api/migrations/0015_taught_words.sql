-- Words taught to search: a name and the photos that show it ("Biscuit" for a dog), sealed
-- on the device under a key members never get, like people.
--
-- Like photos, rows belong to a space tag and never to an account.

CREATE TABLE search_words (
  space TEXT NOT NULL,
  id TEXT NOT NULL,
  meta TEXT NOT NULL,
  PRIMARY KEY (space, id)
);
