import { accountSubscriptions, applySubscription } from './billing-db';
import type { SubscriptionRecord } from './billing-db';
import type { Env } from './env';
import { LIVE_STATUSES, cancelSubscription, razorpaySetup } from './razorpay';
import type { RazorpaySetup, RazorpaySubscription } from './razorpay';

/**
 * Applies Razorpay's view of one of our subscriptions, but only if it is the subscription we
 * created, on the plan we created it with. Anything else is left alone and logged without
 * ids or amounts. Returns whether it was applied.
 */
export async function applyChecked(
  db: D1Database,
  record: SubscriptionRecord,
  entity: RazorpaySubscription,
  now: number,
): Promise<boolean> {
  if (entity.id !== record.id || entity.plan_id !== record.providerPlanId) {
    console.error('Billing: subscription does not match our record; not applied');
    return false;
  }
  await applySubscription(db, record, entity, now);
  return true;
}

/** Whether a subscription can still charge (or is being retried). */
export function isLive(record: SubscriptionRecord): boolean {
  return LIVE_STATUSES.includes(record.status);
}

/** Cancels each of the account's subscriptions that can still charge. */
export async function cancelLive(
  db: D1Database,
  setup: RazorpaySetup,
  accountId: string,
  now: number,
): Promise<void> {
  for (const record of await accountSubscriptions(db, accountId)) {
    if (!isLive(record)) continue;
    await applyChecked(db, record, await cancelSubscription(setup, record.id), now);
  }
}

/**
 * Before an account is deleted: stops every subscription that could still charge it.
 * Returns false if one couldn't be stopped, and then the account must not be deleted.
 */
export async function stopBillingForDeletion(
  env: Env,
  accountId: string,
  now: number,
): Promise<boolean> {
  const live = (await accountSubscriptions(env.DB, accountId)).some(isLive);
  if (!live) return true;
  const setup = razorpaySetup(env);
  if (!setup) return false;
  try {
    await cancelLive(env.DB, setup, accountId, now);
    return true;
  } catch {
    return false;
  }
}
