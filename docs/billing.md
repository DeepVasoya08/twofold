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

## How the limit is decided

- The `billing` table (migration 0024) holds at most one row per account: its plan, the
  plan's `storage_bytes` when it was bought, `paid_until`, and `grace_until` after a failed
  renewal. It belongs to the account, never to a space.
- An account's limit is that row's `storage_bytes` while `paid_until` or `grace_until` is in
  the future, and the Free plan's 1 GB otherwise (or with no row). Nothing is ever deleted
  when a plan ends: uploads stop until the account is under its limit again.
- `reserveStorage` (`apps/api/src/db.ts`) checks the limit in the same statement that adds
  an upload's bytes, so parallel uploads can't go over and a plan ending mid-upload can't be
  raced. `GET /api/account/storage` returns `{ used, limit }`, and the web and phone apps
  show that limit, the same in both spaces.
- Keeping `storage_bytes` on the row means a later change to a plan's size leaves existing
  subscribers as they are until they change plan.
- When storage is full, every route answers with the same words
  (`messages.storageFull`): no price, plan name or link, because the phone apps show it and
  must never point to a purchase (store rules).

## Still to come

Nothing writes to `billing` yet. Next: Razorpay Subscriptions on the server (signed
notifications set the row), then the web's Plans page, Settings → Plan and billing,
payment history and invoices, then the phone apps' plan display and billing emails.
