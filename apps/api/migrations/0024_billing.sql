-- An account's paid plan (docs/billing.md). No row, or a row whose paid time and grace have
-- both run out, means the Free plan. The row belongs to the account, never to a space, so
-- billing can't say whether a private space exists.
--
-- storage_bytes is the plan's limit when it was bought, so later price or size changes leave
-- existing subscribers as they are until they change plan.

CREATE TABLE billing (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  storage_bytes INTEGER NOT NULL,
  -- The end of the time paid for, in ms.
  paid_until INTEGER NOT NULL,
  -- After a failed renewal, the plan keeps counting until this time (ms), or NULL.
  grace_until INTEGER,
  updated_at INTEGER NOT NULL
);
