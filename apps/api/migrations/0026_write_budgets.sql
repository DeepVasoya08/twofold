-- How much each account has added to the database in the current day (records, search and
-- face data, invites), so that no one account can fill it. The key is an HMAC of the account
-- id under the Worker's secret where it has one, so a copy of the database alone doesn't say
-- whose row it is. A row is deleted once its day has passed.
CREATE TABLE write_budgets (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  bytes INTEGER NOT NULL
);

CREATE INDEX write_budgets_by_window ON write_budgets (window_start);
