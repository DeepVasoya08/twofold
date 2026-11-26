-- A random value per space that changes whenever anything in the space changes, so an open
-- app can ask "has anything changed?" with one row read instead of listing everything again.
--
-- It is replaced with a new random value on each change, never counted up and never dated, so
-- it says no more than the rows themselves: that something changed since it was last read.

CREATE TABLE space_stamps (
  space TEXT PRIMARY KEY,
  stamp TEXT NOT NULL
);
