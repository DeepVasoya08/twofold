-- Profile photos, one per space at most. Like photos, a row belongs to a space tag, never to
-- an account, so it can't show whose photo it is or whether an account has a private space.
-- `image` is the photo encrypted on the device; `meta` is an owner-only sealed record that
-- holds its key. `size` is what it costs against the uploader's storage quota.

CREATE TABLE profile_photos (
  space TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  meta TEXT NOT NULL,
  image TEXT NOT NULL,
  size INTEGER NOT NULL
);
