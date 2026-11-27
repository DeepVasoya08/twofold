import { WEBHOOK_SECRET_MIN_LENGTH } from '@arcafold/crypto/webcrypto';
import { z } from 'zod';

import { PAID_PLAN_IDS, PLAN_PERIODS, isSubscribable } from '@arcafold/types';
import type { PaidPlanId, PlanPeriod } from '@arcafold/types';

import type { Env } from './env';

/**
 * Razorpay's REST API, called with fetch (no SDK). Only what billing needs: create, fetch
 * and cancel a subscription. Nothing about the account but its random billing reference is
 * ever sent. See docs/billing.md.
 */
const API = 'https://api.razorpay.com/v1';
const TIMEOUT_MS = 10_000;

/** A plan and period, as `RAZORPAY_PLANS` keys them: "plus:monthly". */
export type PlanKey = `${PaidPlanId}:${PlanPeriod}`;

export interface RazorpaySetup {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  /** Razorpay's plan id for each plan and period sold as a subscription. */
  planIds: ReadonlyMap<PlanKey, string>;
}

const planIdSchema = z.string().regex(/^plan_[A-Za-z0-9]{1,40}$/);

/** Every plan key sold as a subscription. */
export const SUBSCRIBABLE_KEYS: readonly PlanKey[] = PAID_PLAN_IDS.flatMap((plan) =>
  PLAN_PERIODS.filter((period) => isSubscribable(plan, period)).map(
    (period): PlanKey => `${plan}:${period}`,
  ),
);

/**
 * Razorpay's keys and plan ids, or null until all are set (as Worker secrets) and valid. Until
 * then plans can't be bought and Razorpay's notifications are refused.
 */
export function razorpaySetup(env: Env): RazorpaySetup | null {
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!keyId || !/^rzp_(test|live)_[A-Za-z0-9]{1,40}$/.test(keyId)) return null;
  if (!keySecret || !webhookSecret || webhookSecret.length < WEBHOOK_SECRET_MIN_LENGTH) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(env.RAZORPAY_PLANS ?? '');
  } catch {
    return null;
  }
  const parsed = z.record(z.string(), planIdSchema).safeParse(raw);
  if (!parsed.success) return null;
  const planIds = new Map<PlanKey, string>();
  for (const key of SUBSCRIBABLE_KEYS) {
    const id = parsed.data[key];
    if (!id) return null;
    planIds.set(key, id);
  }
  return { keyId, keySecret, webhookSecret, planIds };
}

/** Which plan and period a Razorpay plan id sells, if it is one of ours. */
export function planForId(
  setup: RazorpaySetup,
  planId: string,
): { plan: PaidPlanId; period: PlanPeriod } | null {
  for (const [key, id] of setup.planIds) {
    if (id === planId) {
      const [plan, period] = key.split(':') as [PaidPlanId, PlanPeriod];
      return { plan, period };
    }
  }
  return null;
}

export const SUBSCRIPTION_STATUSES = [
  'created',
  'authenticated',
  'active',
  'pending',
  'halted',
  'cancelled',
  'completed',
  'expired',
  'paused',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Statuses in which a subscription can still charge, or is being retried. */
export const LIVE_STATUSES: readonly SubscriptionStatus[] = [
  'authenticated',
  'active',
  'pending',
  'halted',
];

export const subscriptionIdSchema = z.string().regex(/^sub_[A-Za-z0-9]{1,40}$/);

/** The parts of Razorpay's subscription entity billing reads. Times are Unix seconds. */
export const subscriptionSchema = z.object({
  id: subscriptionIdSchema,
  plan_id: z.string().max(64),
  status: z.enum(SUBSCRIPTION_STATUSES),
  current_end: z.number().int().positive().nullish(),
  paid_count: z.number().int().nonnegative().nullish(),
  payment_method: z.string().max(32).nullish(),
  // Razorpay sends an empty array when a subscription has no notes.
  notes: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).nullish(),
});
export type RazorpaySubscription = z.infer<typeof subscriptionSchema>;

/** The parts of Razorpay's payment entity billing reads. */
export const paymentSchema = z.object({
  id: z.string().regex(/^pay_[A-Za-z0-9]{1,40}$/),
  amount: z.number().int().nonnegative(),
  amount_refunded: z.number().int().nonnegative().nullish(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: z.string().max(32),
  created_at: z.number().int().positive(),
});
export type RazorpayPayment = z.infer<typeof paymentSchema>;

/** Razorpay couldn't be reached, or answered with an error. Holds no response body. */
export class RazorpayError extends Error {
  constructor(readonly status: number | null) {
    super('Razorpay request failed');
    this.name = 'RazorpayError';
  }
}

async function call(
  setup: RazorpaySetup,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = {
    authorization: `Basic ${btoa(`${setup.keyId}:${setup.keySecret}`)}`,
  };
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(TIMEOUT_MS) };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, init);
  } catch {
    throw new RazorpayError(null);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new RazorpayError(res.status);
  }
  try {
    return await res.json();
  } catch {
    throw new RazorpayError(res.status);
  }
}

function asSubscription(data: unknown): RazorpaySubscription {
  const parsed = subscriptionSchema.safeParse(data);
  if (!parsed.success) throw new RazorpayError(null);
  return parsed.data;
}

/** How many times a subscription charges before it ends: about ten years. */
const TOTAL_COUNT: Readonly<Record<PlanPeriod, number>> = { monthly: 120, yearly: 10 };

/** Creates a subscription that starts as soon as the buyer pays in Checkout. */
export async function createSubscription(
  setup: RazorpaySetup,
  planId: string,
  period: PlanPeriod,
  ref: string,
): Promise<RazorpaySubscription> {
  return asSubscription(
    await call(setup, 'POST', '/subscriptions', {
      plan_id: planId,
      total_count: TOTAL_COUNT[period],
      customer_notify: 1,
      notes: { ref },
    }),
  );
}

export async function fetchSubscription(
  setup: RazorpaySetup,
  id: string,
): Promise<RazorpaySubscription> {
  return asSubscription(await call(setup, 'GET', `/subscriptions/${id}`));
}

/**
 * Cancels a subscription at once, so it never charges again. The time already paid for is
 * kept on our side (`billing.paid_until`), so the plan still runs to the end of the period.
 */
export async function cancelSubscription(
  setup: RazorpaySetup,
  id: string,
): Promise<RazorpaySubscription> {
  return asSubscription(
    await call(setup, 'POST', `/subscriptions/${id}/cancel`, { cancel_at_cycle_end: 0 }),
  );
}
