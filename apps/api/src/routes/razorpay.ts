import { webhookSignatureMatches } from '@arcafold/crypto/webcrypto';
import { Hono } from 'hono';
import { z } from 'zod';

import { applyChecked } from '../billing';
import {
  eventHandled,
  findSubscription,
  markEventHandled,
  recordPayment,
  recordRefund,
} from '../billing-db';
import {
  RazorpayError,
  fetchSubscription,
  paymentSchema,
  razorpaySetup,
  subscriptionIdSchema,
} from '../razorpay';
import type { RazorpayPayment } from '../razorpay';
import { messages } from '../respond';
import type { AppEnv } from '../session';

/**
 * Razorpay's notifications (webhooks), at POST /api/billing/razorpay. No session: the
 * signature over the raw body, with the webhook secret, is checked before anything in the
 * body is read. A notification only says which subscription changed; its state is fetched
 * from Razorpay, so a late or repeated notification can't undo a newer one. Payloads are
 * never logged. See docs/billing.md.
 */
export const razorpay = new Hono<AppEnv>();

/** Razorpay's notifications are a few kilobytes. */
const MAX_BODY = 64 * 1024;

const eventIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const eventSchema = z.object({
  event: z.string().max(64),
  payload: z.object({
    subscription: z.object({ entity: z.object({ id: subscriptionIdSchema }) }).optional(),
    payment: z.object({ entity: z.unknown() }).optional(),
  }),
});

razorpay.post('/', async (c) => {
  const setup = razorpaySetup(c.env);
  if (!setup) return c.json({ error: messages.plansUnavailable }, 503);
  const raw = await c.req.text();
  if (raw.length > MAX_BODY) return c.json({ error: messages.badRequest }, 413);
  const signature = c.req.header('x-razorpay-signature') ?? '';
  if (!(await webhookSignatureMatches(setup.webhookSecret, raw, signature))) {
    return c.json({ error: messages.badRequest }, 400);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return c.json({ error: messages.badRequest }, 400);
  }
  const parsed = eventSchema.safeParse(parsedJson);
  if (!parsed.success) return c.json({ error: messages.badRequest }, 400);
  const event = parsed.data;
  const eventId = eventIdSchema.safeParse(c.req.header('x-razorpay-event-id'));
  const db = c.env.DB;
  const now = Date.now();
  if (eventId.success && (await eventHandled(db, eventId.data))) return c.body(null, 200);

  const payment = paymentOf(event.payload.payment?.entity);
  try {
    const subscriptionId = event.payload.subscription?.entity.id;
    if (event.event.startsWith('subscription.') && subscriptionId) {
      const record = await findSubscription(db, subscriptionId);
      if (!record) {
        // Not one this server created (another environment sharing the Razorpay account).
        console.error('Billing: notification for an unknown subscription');
      } else {
        const matches =
          !payment || (payment.amount === record.amount && payment.currency === 'INR');
        if (payment) await recordPayment(db, record, payment);
        if (matches) {
          await applyChecked(db, record, await fetchSubscription(setup, record.id), now);
        } else {
          console.error('Billing: payment does not match the plan’s price; plan not changed');
        }
      }
    } else if (event.event.startsWith('refund.')) {
      if (payment) await recordRefund(db, payment);
    }
  } catch (error) {
    if (error instanceof RazorpayError) {
      // Razorpay retries a notification that isn't answered with a 2xx.
      console.error('Billing: Razorpay request failed', error.status ?? 'network');
      return c.json({ error: messages.paymentsUnreachable }, 503);
    }
    throw error;
  }
  if (eventId.success) await markEventHandled(db, eventId.data, now);
  return c.body(null, 200);
});

function paymentOf(entity: unknown): RazorpayPayment | null {
  const parsed = paymentSchema.safeParse(entity);
  return parsed.success ? parsed.data : null;
}
