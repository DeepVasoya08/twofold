-- Keyring versions become random rather than a count, so one copy of an account no longer
-- says how often (or whether) its keyring changed: a count still at 1 said a private space
-- was never set up. Each existing version is replaced once by a random whole number from 1
-- to 2^53 - 1; a device holding an old one gets a conflict on its next keyring change and
-- reloads the account first. New versions are made by apps/api/src/keyring-version.ts.
UPDATE accounts
SET version = ((random() % 9007199254740991) + 9007199254740991) % 9007199254740991 + 1;
