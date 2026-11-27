-- Payments through Razorpay (docs/billing.md). Everything here belongs to the account,
-- never to a space, so billing can't say whether a private space exists.

-- 0024's billing table held one row per account and nothing ever wrote to it. It becomes one
-- row per paid source (a Razorpay subscription now, a one-time yearly payment later), and
-- the account's limit is the largest plan among its rows that are still paid for or in
-- grace. Two sources at once (a plan bought in two tabs) can then never lower the limit.
DROP TABLE billing;

CREATE TABLE billing (
  -- The Razorpay subscription id that pays for it.
  source_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  -- The plan's limit when it was bought: a later change to a plan's size leaves this as is.
  storage_bytes INTEGER NOT NULL,
  -- The end of the time paid for, in ms. Only ever moves later.
  paid_until INTEGER NOT NULL,
  -- After a failed renewal, the plan keeps counting until this time (ms), or NULL.
  grace_until INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX billing_account ON billing (account_id);

-- What Razorpay knows an account by: a random reference, never the account id or email.
-- busy_until stops two subscribe requests from the same account running at once.
CREATE TABLE billing_customers (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  ref TEXT NOT NULL UNIQUE,
  busy_until INTEGER NOT NULL DEFAULT 0
);

-- Razorpay subscriptions, as last fetched from Razorpay. Kept after the account is deleted
-- (account_id becomes NULL), since payment records must be kept by law.
CREATE TABLE billing_subscriptions (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts (id) ON DELETE SET NULL,
  plan TEXT NOT NULL,
  period TEXT NOT NULL,
  -- The Razorpay plan it was created with, and that plan's price (paise) at the time.
  provider_plan_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  -- card, upi or emandate, once known.
  method TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX billing_subscriptions_account ON billing_subscriptions (account_id);

-- Every payment and failed attempt, for payment history and invoices. Kept after the
-- account is deleted, like subscriptions.
CREATE TABLE billing_payments (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts (id) ON DELETE SET NULL,
  subscription_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  period TEXT NOT NULL,
  amount INTEGER NOT NULL,
  refunded INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  -- paid, failed or refunded.
  status TEXT NOT NULL,
  at INTEGER NOT NULL,
  -- Ours, in order without gaps (ARC-2026-00001); paid payments only.
  invoice_number TEXT UNIQUE
);

CREATE INDEX billing_payments_account ON billing_payments (account_id, at);

-- The last invoice number used, per year (name 'invoice-2026').
CREATE TABLE billing_counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- Razorpay notifications already handled, so a repeat is answered without doing anything.
CREATE TABLE billing_events (
  id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);

CREATE INDEX billing_events_received ON billing_events (received_at);
