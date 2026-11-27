import { Hono } from 'hono';
import type { Context } from 'hono';

import { PLAN_PRICES_INR, isSubscribable } from '@arcafold/types';
import type { BillingStatus, SubscribeResponse } from '@arcafold/types';

import { applyChecked, cancelLive, isLive } from '../billing';
import {
  accountSubscriptions,
  billingStatus,
  customerRef,
  findSubscription,
  hasPaidPlan,
  insertSubscription,
  listPayments,
  lockSubscribe,
  unlockSubscribe,
} from '../billing-db';
import {
  RazorpayError,
  cancelSubscription,
  createSubscription,
  fetchSubscription,
  razorpaySetup,
} from '../razorpay';
import { messages, readBody } from '../respond';
import { confirmSubscriptionSchema, emptySchema, subscribeSchema } from '../schemas';
import type { AppEnv } from '../session';

/**
 * The signed-in account's plan, mounted at /account/billing (account routes, never space
 * routes, so they answer the same in every space). The browser never says what was paid:
 * every change to a plan comes from Razorpay, through its signed notifications or a fetch
 * the server makes itself. See docs/billing.md.
 */
export const billing = new Hono<AppEnv>();

/** An unpaid subscription for the same plan is handed back for this long, not remade. */
const REUSE_MS = 60 * 60 * 1000;

async function statusOf(c: Context<AppEnv>): Promise<BillingStatus> {
  const status = await billingStatus(c.env.DB, c.get('account').id, Date.now());
  return { ...status, available: razorpaySetup(c.env) !== null };
}

function unreachable(c: Context<AppEnv>, error: unknown): Response {
  if (error instanceof RazorpayError) {
    console.error('Billing: Razorpay request failed', error.status ?? 'network');
    return c.json({ error: messages.paymentsUnreachable }, 502);
  }
  throw error;
}

billing.get('/', async (c) => c.json(await statusOf(c)));

billing.get('/payments', async (c) =>
  c.json({ payments: await listPayments(c.env.DB, c.get('account').id) }),
);

/**
 * Starts a subscription for Razorpay Checkout. One at a time per account: a repeat for the
 * same plan gets the same unpaid subscription back, and starting a different one first
 * cancels the unpaid ones, so only one Checkout can ever be paid.
 */
billing.post('/subscribe', async (c) => {
  const setup = razorpaySetup(c.env);
  if (!setup) return c.json({ error: messages.plansUnavailable }, 503);
  const body = await readBody(c, subscribeSchema);
  if (!body || !isSubscribable(body.plan, body.period)) {
    return c.json({ error: messages.badRequest }, 400);
  }
  const providerPlanId = setup.planIds.get(`${body.plan}:${body.period}`);
  if (!providerPlanId) return c.json({ error: messages.plansUnavailable }, 503);
  const db = c.env.DB;
  const accountId = c.get('account').id;
  const now = Date.now();
  const ref = await customerRef(db, accountId);
  if (!(await lockSubscribe(db, accountId, now))) {
    return c.json({ error: messages.billingBusy }, 409);
  }
  try {
    if (await hasPaidPlan(db, accountId, now)) return c.json({ error: messages.planExists }, 409);
    const records = await accountSubscriptions(db, accountId);
    if (records.some(isLive)) return c.json({ error: messages.planExists }, 409);
    // An unpaid subscription may have been paid since; ask Razorpay before reusing or
    // cancelling it.
    let reuse: string | null = null;
    for (const record of records.filter((r) => r.status === 'created')) {
      const entity = await fetchSubscription(setup, record.id);
      await applyChecked(db, record, entity, now);
      if (entity.status !== 'created') {
        if (entity.status === 'expired' || entity.status === 'cancelled') continue;
        return c.json({ error: messages.planExists }, 409);
      }
      const same =
        record.plan === body.plan &&
        record.period === body.period &&
        record.providerPlanId === providerPlanId &&
        now - record.createdAt < REUSE_MS;
      if (same && reuse === null) {
        reuse = record.id;
      } else {
        await applyChecked(db, record, await cancelSubscription(setup, record.id), now);
      }
    }
    if (reuse !== null) {
      return c.json<SubscribeResponse>({ subscriptionId: reuse, keyId: setup.keyId });
    }
    const entity = await createSubscription(setup, providerPlanId, body.period, ref);
    if (entity.plan_id !== providerPlanId) throw new RazorpayError(null);
    await insertSubscription(
      db,
      {
        id: entity.id,
        accountId,
        plan: body.plan,
        period: body.period,
        providerPlanId,
        amount: PLAN_PRICES_INR[body.plan][body.period],
        status: entity.status,
        createdAt: now,
      },
      now,
    );
    return c.json<SubscribeResponse>({ subscriptionId: entity.id, keyId: setup.keyId }, 201);
  } catch (error) {
    return unreachable(c, error);
  } finally {
    await unlockSubscribe(db, accountId);
  }
});

/**
 * Called after Checkout closes so the new plan shows at once. The server fetches the
 * subscription from Razorpay itself; the notification would set the same thing a moment
 * later.
 */
billing.post('/confirm', async (c) => {
  const setup = razorpaySetup(c.env);
  if (!setup) return c.json({ error: messages.plansUnavailable }, 503);
  const body = await readBody(c, confirmSubscriptionSchema);
  if (!body) return c.json({ error: messages.badRequest }, 400);
  const record = await findSubscription(c.env.DB, body.subscriptionId);
  if (record?.accountId !== c.get('account').id) {
    return c.json({ error: messages.badRequest }, 404);
  }
  try {
    await applyChecked(c.env.DB, record, await fetchSubscription(setup, record.id), Date.now());
  } catch (error) {
    return unreachable(c, error);
  }
  return c.json(await statusOf(c));
});

/**
 * Stops the plan from renewing. Razorpay stops charging at once; the time already paid for
 * is kept, so the plan runs to the end of its period. Nothing is deleted.
 */
billing.post('/cancel', async (c) => {
  const setup = razorpaySetup(c.env);
  if (!setup) return c.json({ error: messages.plansUnavailable }, 503);
  if (!(await readBody(c, emptySchema))) return c.json({ error: messages.badRequest }, 400);
  try {
    await cancelLive(c.env.DB, setup, c.get('account').id, Date.now());
  } catch (error) {
    return unreachable(c, error);
  }
  return c.json(await statusOf(c));
});
