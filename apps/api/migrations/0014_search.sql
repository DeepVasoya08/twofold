-- Smart search: what each photo shows, worked out on the device.
--
-- `search_segments` holds batches of photos' search vectors, sealed on the device under a
-- key members never get and padded so a segment's size doesn't say how many photos it
-- holds. `size` is what it costs against the uploader's storage quota.
--
-- Like face results, rows belong to a space tag and never to an account.

CREATE TABLE search_segments (
  space TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (space, id)
);
