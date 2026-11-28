-- Each account's running counts now live in a Durable Object of their own (src/counters.ts):
-- its storage total, what it added to the database in the last day, and its wrong invite
-- codes. Each of these moves when one of the account's spaces changes, so here two copies of
-- the database (two nightly backups, or two points of its 30-day history) could line an
-- account up with the spaces whose rows changed in between
-- (docs/security.md#account-totals-live-outside-the-database).
--
-- accounts.stored_bytes keeps each total until it moves: the first request that uses an
-- account's total takes what is left here, leaving 0, and adds it to the account's counters.
--
-- The day's counts and invite tries kept here are dropped. The write_budgets table itself
-- stays for now, empty, because migrations run before the new Worker is deployed and the
-- Worker before it may still be counting there. A later migration drops it.
DELETE FROM write_budgets;

DELETE FROM login_failures WHERE email LIKE 'invite:%';
