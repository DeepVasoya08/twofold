# Plans and billing

What a plan is, how the server decides an account's storage limit, and what's still to
come. The product decisions are in the payment design doc; this file describes the code.

## Plans

| Plan | Storage (whole account, every space) |
| ---- | ------------------------------------ |
| Free | 1 GB                                 |
| Plus | 50 GB                                |
| Pro  | 200 GB                               |
| Max  | 1 TB                                 |

`PLAN_IDS` and `PLAN_STORAGE` in `@arcafold/types` list them. A plan only ever sets one
thing, the account's storage limit. Every feature, the private space included, is on every
plan, so a plan says nothing about which spaces an account has.

Prices are in `PLAN_PRICES_INR` (paise, GST included; a year costs 11 months). Every plan
and period is sold as a Razorpay subscription except yearly Max: at ₹24,739 it is above UPI
AutoPay's ₹15,000 limit for a debit without the buyer's approval, so it will be a one-time
yearly payment (`isSubscribable`; not built yet).

## How the limit is decided

- The `billing` table (migration 0025) holds one row per paid source, today a Razorpay
  subscription: the plan, the plan's `storage_bytes` when it was bought, `paid_until`, and
  `grace_until` after a failed renewal. It belongs to the account, never to a space.
- An account's limit is the largest `storage_bytes` among its rows whose `paid_until` or
  `grace_until` is in the future, and the Free plan's 1 GB otherwise (never less). Nothing
  is ever deleted when a plan ends: uploads stop until the account is under its limit again.
- `reserveStorage` (`apps/api/src/db.ts`) checks the limit in the same statement that adds
  an upload's bytes, so parallel uploads can't go over and a plan ending mid-upload can't be
  raced. `GET /api/account/storage` returns `{ used, limit }`, and the web and phone apps
  show that limit, the same in both spaces.
- Keeping `storage_bytes` on the row means a later change to a plan's size leaves existing
  subscribers as they are until they change plan. Each subscription also keeps the price it
  was created at, so a later price change doesn't make their payments look wrong.
- When storage is full, every route answers with the same words
  (`messages.storageFull`): no price, plan name or link, because the phone apps show it and
  must never point to a purchase (store rules).

## Razorpay

Razorpay's REST API is called with `fetch` (`apps/api/src/razorpay.ts`, no SDK). The browser
never tells the server what was paid: a plan only changes from Razorpay's signed
notifications, or from a subscription the server fetches from Razorpay itself.

### Routes

Account routes (session needed, never space routes, so they answer the same in every space):

| Route                                 | What it does                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/account/billing`            | `BillingStatus`: plan, period, paid until, grace until, whether it renews, whether a renewal failed, and whether Razorpay is set up.                                                                                                                                                                                                                    |
| `GET /api/account/billing/payments`   | Payment history, newest first: paid, failed and refunded payments with our invoice numbers.                                                                                                                                                                                                                                                             |
| `POST /api/account/billing/subscribe` | `{ plan, period }` → `{ subscriptionId, keyId }` for Razorpay Checkout. Refused (409) while a plan is paid for or a subscription is live. A repeat for the same plan within an hour gets the same unpaid subscription back; one for another plan cancels the unpaid ones first, so only one Checkout can be paid. A per-account lock stops two at once. |
| `POST /api/account/billing/confirm`   | `{ subscriptionId }` after Checkout: the server fetches that subscription (the account's own only) from Razorpay and applies it, so the plan shows before the notification arrives.                                                                                                                                                                     |
| `POST /api/account/billing/cancel`    | Cancels every live subscription at Razorpay at once, so nothing charges again. The time already paid for is kept, so the plan runs to the end of its period.                                                                                                                                                                                            |

`POST /api/billing/razorpay` takes Razorpay's notifications, with no session. In order:

1. The `X-Razorpay-Signature` header must be the HMAC-SHA256 (hex) of the raw body under
   the webhook secret (`webhookSignatureMatches` in `@arcafold/crypto/webcrypto`), checked
   before anything in the body is read. Bodies over 64 KB are refused.
2. A notification whose `X-Razorpay-Event-Id` was already handled is answered with 200 and
   nothing else. Ids are kept for 30 days.
3. For `subscription.*`, a payment in the notification is recorded for payment history. Then,
   unless that payment's amount or currency isn't the subscription's price, the server
   fetches the subscription from Razorpay and applies Razorpay's current state. The
   notification's own copy of the subscription is never used, so the order notifications
   arrive in doesn't matter.
4. For `refund.*`, the payment's refunded amount is updated.
5. If Razorpay can't be reached, the answer is 503 and Razorpay sends it again later.

Notifications for subscriptions this server didn't create are ignored. Payloads, ids and
amounts are never logged.

### Applying a subscription

`applySubscription` (`apps/api/src/billing-db.ts`) is safe to repeat and to run in any order:

| Razorpay status          | What changes                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `active` (has charged)   | `paid_until` moves to the end of the current period; it never moves earlier. Grace is cleared.                |
| `pending`, `halted`      | A renewal failed: `grace_until` becomes `paid_until` + 7 days (never later on a repeat).                      |
| `cancelled`, `completed` | Keeps what is there; if no row exists yet (cancelled before we heard it was paid), adds the time it paid for. |
| others                   | Only our copy of the status changes.                                                                          |

It only applies a subscription that is ours, on the Razorpay plan we created it with.

### Payment history and invoice numbers

Each paid payment gets our invoice number, `ARC-<year>-<00001>`, by year in India time, from
`billing_counters` in the same transaction that records the payment, so two at once never
share or skip a number. Failed attempts are listed without a number. Payments and
subscriptions are kept when the account is deleted (`account_id` becomes NULL), since
payment records must be kept by law.

### Deleting an account

Before an account is deleted, every subscription that could still charge it is cancelled
at Razorpay. If Razorpay can't be reached, the account isn't deleted and the person is
asked to try again, so nobody is charged for an account that no longer exists.

### Privacy

Razorpay only sees a random billing reference (`billing_customers.ref`, sent as the
subscription's `notes.ref`), the plan and the amount, plus whatever the buyer types into
Checkout. Never the account id, email or name, and nothing about spaces.

### Setup

Four Worker secrets, copied from the `production` environment's GitHub secrets by
`deploy.yml`. Until all four are set and valid, plans can't be bought
(`BillingStatus.available` is false) and notifications are refused.

| Secret                    | What it is                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAZORPAY_KEY_ID`         | The API key id (`rzp_test_…` in test mode, `rzp_live_…` live).                                                                                     |
| `RAZORPAY_KEY_SECRET`     | The API key secret.                                                                                                                                |
| `RAZORPAY_WEBHOOK_SECRET` | The secret set on the webhook in Razorpay's dashboard (16 characters or more).                                                                     |
| `RAZORPAY_PLANS`          | JSON of Razorpay plan ids: `{"plus:monthly":"plan_…","plus:yearly":"plan_…","pro:monthly":"plan_…","pro:yearly":"plan_…","max:monthly":"plan_…"}`. |

In Razorpay's dashboard: create the five plans at the prices in `PLAN_PRICES_INR`, and add
a webhook to `https://arcafold.com/api/billing/razorpay` with the `subscription.*` and
`refund.processed` events.

## Still to come

Upgrades and downgrades (a new subscription, the old one cancelled, unused days refunded),
yearly Max as a one-time payment, then the web's Plans page, Settings → Plan and billing,
payment history and invoices, the phone apps' plan display, and billing emails. Refund and
dispute rules aren't decided yet.
