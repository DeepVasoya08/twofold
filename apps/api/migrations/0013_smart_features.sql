-- The answer to the smart features question shown after sign-up: whether face grouping
-- starts on for the account's devices ('on' or 'off'), which version of the question was
-- answered, and the day it was answered (as a record of consent). NULL until answered.
-- It belongs to the account and is the same whichever space is open.

ALTER TABLE accounts ADD COLUMN smart_choice TEXT;
ALTER TABLE accounts ADD COLUMN smart_version INTEGER;
ALTER TABLE accounts ADD COLUMN smart_at INTEGER;
