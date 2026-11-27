import { randomBytes, toBase64Url } from '@arcafold/crypto/webcrypto';

import { PLAN_STORAGE } from '@arcafold/types';
import type {
  BillingPayment,
  BillingStatus,
  PaidPlanId,
  PaymentStatus,
  PlanPeriod,
} from '@arcafold/types';

import type { RazorpayPayment, RazorpaySubscription, SubscriptionStatus } from './razorpay';

/** Billing's tables (migration 0025, docs/billing.md). All belong to the account. */

/** How long a plan keeps counting after a renewal fails, while Razorpay retries. */
export const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** How long one subscribe request holds the account's lock. */
const SUBSCRIBE_LOCK_MS = 30_000;

/** How long handled notification ids are kept. Razorpay retries for about a day. */
const EVENT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** India Standard Time, for which year an invoice number belongs to. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export interface SubscriptionRecord {
  id: string;
  accountId: string | null;
  plan: PaidPlanId;
  period: PlanPeriod;
  providerPlanId: string;
  amount: number;
  status: SubscriptionStatus;
  createdAt: number;
}

interface SubscriptionRow {
  id: string;
  account_id: string | null;
  plan: PaidPlanId;
  period: PlanPeriod;
  provider_plan_id: string;
  amount: number;
  status: SubscriptionStatus;
  created_at: number;
}

const SUBSCRIPTION_COLUMNS =
  'id, account_id, plan, period, provider_plan_id, amount, status, created_at';

function toSubscription(row: SubscriptionRow): SubscriptionRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    plan: row.plan,
    period: row.period,
    providerPlanId: row.provider_plan_id,
    amount: row.amount,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** The account's billing reference, made on first use: random, so it says nothing. */
export async function customerRef(db: D1Database, accountId: string): Promise<string> {
  const [, select] = await db.batch([
    db
      .prepare('INSERT OR IGNORE INTO billing_customers (account_id, ref) VALUES (?, ?)')
      .bind(accountId, `c_${toBase64Url(randomBytes(16))}`),
    db.prepare('SELECT ref FROM billing_customers WHERE account_id = ?').bind(accountId),
  ]);
  const row = select?.results[0] as { ref: string } | undefined;
  if (!row) throw new Error('Billing customer missing');
  return row.ref;
}

/**
 * Takes the account's subscribe lock, so a double click or a second tab can't start two
 * subscriptions at once. Returns false if another request holds it.
 */
export async function lockSubscribe(
  db: D1Database,
  accountId: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE billing_customers SET busy_until = ? WHERE account_id = ? AND busy_until <= ?')
    .bind(now + SUBSCRIBE_LOCK_MS, accountId, now)
    .run();
  return result.meta.changes === 1;
}

export async function unlockSubscribe(db: D1Database, accountId: string): Promise<void> {
  await db
    .prepare('UPDATE billing_customers SET busy_until = 0 WHERE account_id = ?')
    .bind(accountId)
    .run();
}

export async function findSubscription(
  db: D1Database,
  id: string,
): Promise<SubscriptionRecord | null> {
  const row = await db
    .prepare(`SELECT ${SUBSCRIPTION_COLUMNS} FROM billing_subscriptions WHERE id = ?`)
    .bind(id)
    .first<SubscriptionRow>();
  return row ? toSubscription(row) : null;
}

/** The account's subscriptions, newest first. */
export async function accountSubscriptions(
  db: D1Database,
  accountId: string,
): Promise<SubscriptionRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SUBSCRIPTION_COLUMNS} FROM billing_subscriptions
        WHERE account_id = ? ORDER BY created_at DESC`,
    )
    .bind(accountId)
    .all<SubscriptionRow>();
  return results.map(toSubscription);
}

export async function insertSubscription(
  db: D1Database,
  record: SubscriptionRecord,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO billing_subscriptions
         (id, account_id, plan, period, provider_plan_id, amount, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      record.id,
      record.accountId,
      record.plan,
      record.period,
      record.providerPlanId,
      record.amount,
      record.status,
      record.createdAt,
      now,
    )
    .run();
}

/** Whether the account has a plan that is paid for or in grace at `now`. */
export async function hasPaidPlan(
  db: D1Database,
  accountId: string,
  now: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS yes FROM billing
        WHERE account_id = ? AND MAX(paid_until, COALESCE(grace_until, 0)) > ? LIMIT 1`,
    )
    .bind(accountId, now)
    .first<{ yes: number }>();
  return row !== null;
}

/**
 * Brings our copy of a subscription in line with Razorpay's, as just fetched from Razorpay,
 * and with it the plan's paid time. Safe to repeat and to run in any order:
 * - paid_until only ever moves later, and only from an active subscription that has charged;
 * - a failed renewal (pending, halted) adds grace from the end of the time paid for;
 * - a subscription cancelled before we heard it was paid still gets the time it paid for.
 */
export async function applySubscription(
  db: D1Database,
  record: SubscriptionRecord,
  entity: RazorpaySubscription,
  now: number,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE billing_subscriptions SET status = ?, method = COALESCE(?, method), updated_at = ?
          WHERE id = ?`,
      )
      .bind(entity.status, entity.payment_method ?? null, now, record.id),
  ];
  const paidEnd =
    (entity.paid_count ?? 0) > 0 && entity.current_end ? entity.current_end * 1000 : null;
  if (record.accountId && paidEnd !== null) {
    const insert = `INSERT INTO billing
        (source_id, account_id, plan, storage_bytes, paid_until, grace_until, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)`;
    const values = [record.id, record.accountId, record.plan, PLAN_STORAGE[record.plan], paidEnd];
    if (entity.status === 'active') {
      statements.push(
        db
          .prepare(
            `${insert} ON CONFLICT (source_id) DO UPDATE SET
               paid_until = MAX(paid_until, excluded.paid_until), grace_until = NULL,
               updated_at = excluded.updated_at`,
          )
          .bind(...values, now),
      );
    } else if (entity.status === 'cancelled' || entity.status === 'completed') {
      statements.push(
        db.prepare(`${insert} ON CONFLICT (source_id) DO NOTHING`).bind(...values, now),
      );
    }
  }
  if (record.accountId && (entity.status === 'pending' || entity.status === 'halted')) {
    statements.push(
      db
        .prepare(
          `UPDATE billing SET grace_until = MAX(COALESCE(grace_until, 0), paid_until + ?),
             updated_at = ? WHERE source_id = ?`,
        )
        .bind(GRACE_MS, now, record.id),
    );
  }
  await db.batch(statements);
}

function invoiceYear(at: number): number {
  return new Date(at + IST_OFFSET_MS).getUTCFullYear();
}

/**
 * Records a subscription's payment for payment history. A new paid payment takes the next
 * invoice number of its year in the same transaction, so two at once never share or skip a
 * number. A repeat only ever raises the refunded amount.
 */
export async function recordPayment(
  db: D1Database,
  record: SubscriptionRecord,
  payment: RazorpayPayment,
): Promise<void> {
  const at = payment.created_at * 1000;
  const refunded = payment.amount_refunded ?? 0;
  const paid = payment.status === 'captured' || payment.status === 'refunded';
  if (!paid && payment.status !== 'failed') return;
  const status: PaymentStatus = !paid
    ? 'failed'
    : refunded >= payment.amount && payment.amount > 0
      ? 'refunded'
      : 'paid';
  const values = [
    payment.id,
    record.accountId,
    record.id,
    record.plan,
    record.period,
    payment.amount,
    refunded,
    payment.currency,
    status,
    at,
  ];
  const columns =
    'id, account_id, subscription_id, plan, period, amount, refunded, currency, status, at';
  if (!paid) {
    await db
      .prepare(
        `INSERT INTO billing_payments (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
      )
      .bind(...values)
      .run();
    return;
  }
  const year = invoiceYear(at);
  const counter = `invoice-${String(year)}`;
  await db.batch([
    db
      .prepare(
        `INSERT INTO billing_counters (name, value)
           SELECT ?1, 1 WHERE NOT EXISTS (SELECT 1 FROM billing_payments WHERE id = ?2)
         ON CONFLICT (name) DO UPDATE SET value = value + 1`,
      )
      .bind(counter, payment.id),
    db
      .prepare(
        `INSERT INTO billing_payments (${columns}, invoice_number)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, printf('ARC-%d-%05d', ?, value)
             FROM billing_counters WHERE name = ?
         ON CONFLICT (id) DO UPDATE SET
           refunded = MAX(billing_payments.refunded, excluded.refunded),
           status = CASE WHEN MAX(billing_payments.refunded, excluded.refunded)
                              >= billing_payments.amount
                         THEN 'refunded' ELSE billing_payments.status END`,
      )
      .bind(...values, year, counter),
  ]);
}

/** Raises a recorded payment's refunded amount (a refund made in Razorpay's dashboard). */
export async function recordRefund(db: D1Database, payment: RazorpayPayment): Promise<void> {
  await db
    .prepare(
      `UPDATE billing_payments SET refunded = MAX(refunded, ?1),
         status = CASE WHEN MAX(refunded, ?1) >= amount AND status = 'paid'
                       THEN 'refunded' ELSE status END
        WHERE id = ?2`,
    )
    .bind(payment.amount_refunded ?? 0, payment.id)
    .run();
}

export async function eventHandled(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS yes FROM billing_events WHERE id = ?')
    .bind(id)
    .first<{ yes: number }>();
  return row !== null;
}

/** Remembers a handled notification, and forgets ones too old to be retried. */
export async function markEventHandled(db: D1Database, id: string, now: number): Promise<void> {
  await db.batch([
    db
      .prepare('INSERT OR IGNORE INTO billing_events (id, received_at) VALUES (?, ?)')
      .bind(id, now),
    db.prepare('DELETE FROM billing_events WHERE received_at < ?').bind(now - EVENT_KEEP_MS),
  ]);
}

/**
 * The plan that sets the account's limit: the largest still paid for or in grace (the same
 * rule as the limit in db.ts), with its subscription's state.
 */
export async function billingStatus(
  db: D1Database,
  accountId: string,
  now: number,
): Promise<Omit<BillingStatus, 'available'>> {
  const row = await db
    .prepare(
      `SELECT b.plan, b.paid_until, b.grace_until, s.period, s.status
         FROM billing b JOIN billing_subscriptions s ON s.id = b.source_id
        WHERE b.account_id = ? AND MAX(b.paid_until, COALESCE(b.grace_until, 0)) > ?
        ORDER BY b.storage_bytes DESC, b.paid_until DESC LIMIT 1`,
    )
    .bind(accountId, now)
    .first<{
      plan: PaidPlanId;
      paid_until: number;
      grace_until: number | null;
      period: PlanPeriod;
      status: SubscriptionStatus;
    }>();
  if (!row) {
    return {
      plan: 'free',
      period: null,
      paidUntil: null,
      graceUntil: null,
      renews: false,
      paymentFailed: false,
    };
  }
  return {
    plan: row.plan,
    period: row.period,
    paidUntil: row.paid_until,
    graceUntil: row.grace_until,
    renews: row.status === 'active' || row.status === 'authenticated',
    paymentFailed: row.status === 'pending' || row.status === 'halted',
  };
}

/** The account's payments and failed attempts, newest first. */
export async function listPayments(db: D1Database, accountId: string): Promise<BillingPayment[]> {
  const { results } = await db
    .prepare(
      `SELECT id, at, plan, period, amount, refunded, currency, status, invoice_number
         FROM billing_payments WHERE account_id = ? ORDER BY at DESC, id LIMIT 500`,
    )
    .bind(accountId)
    .all<{
      id: string;
      at: number;
      plan: PaidPlanId;
      period: PlanPeriod;
      amount: number;
      refunded: number;
      currency: string;
      status: PaymentStatus;
      invoice_number: string | null;
    }>();
  return results.map((row) => ({
    id: row.id,
    at: row.at,
    plan: row.plan,
    period: row.period,
    amount: row.amount,
    refunded: row.refunded,
    currency: row.currency,
    status: row.status,
    invoiceNumber: row.invoice_number,
  }));
}
