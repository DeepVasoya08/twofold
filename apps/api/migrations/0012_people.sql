-- People: faces found and grouped on the device.
--
-- `face_segments` holds what the face models produced, sealed on the device under a key
-- members never get: batches of results, padded so a segment's size doesn't say how many
-- faces it holds. `size` is what it costs against the uploader's storage quota.
-- `people` holds each person's name and faces, sealed the same way.
--
-- Like photos, rows belong to a space tag and never to an account, and nothing here says
-- which faces belong to whom.

CREATE TABLE face_segments (
  space TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (space, id)
);

CREATE TABLE people (
  space TEXT NOT NULL,
  id TEXT NOT NULL,
  meta TEXT NOT NULL,
  PRIMARY KEY (space, id)
);
