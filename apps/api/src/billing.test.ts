import { toBase64Url, webhookSignature } from '@arcafold/crypto/webcrypto';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PLAN_PRICES_INR, PLAN_STORAGE, STORAGE_SIZES } from '@arcafold/types';
import type { BillingPayment, BillingStatus, SubscribeResponse } from '@arcafold/types';

import { GRACE_MS } from './billing-db';
import type { Env } from './env';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';

const EMAIL = 'sam@example.com';
const KEY_ID = 'rzp_test_Abc123';
const KEY_SECRET = 'test-key-secret';
const WEBHOOK_SECRET = 'test-webhook-secret-123';
const PLANS = {
  'plus:monthly': 'plan_PlusM',
  'plus:yearly': 'plan_PlusY',
  'pro:monthly': 'plan_ProM',
  'pro:yearly': 'plan_ProY',
  'max:monthly': 'plan_MaxM',
};
const DAY = 24 * 60 * 60 * 1000;
const PLUS_MONTHLY = PLAN_PRICES_INR.plus.monthly;

interface FakeSubscription {
  id: string;
  plan_id: string;
  status: string;
  current_end: number | null;
  paid_count: number;
  payment_method: string | null;
  notes: Record<string, string> | [];
}

/** A stand-in for Razorpay's subscription API, answering the Worker's fetch calls. */
class FakeRazorpay {
  subscriptions = new Map<string, FakeSubscription>();
  /** Every request body sent to Razorpay, to check nothing about the account leaks. */
  bodies: string[] = [];
  calls: string[] = [];
  down = false;
  private next = 1;

  handle = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? 'GET';
    this.calls.push(`${method} ${url.pathname}`);
    if (this.down) throw new TypeError('fetch failed');
    const auth = new Headers(init?.headers).get('authorization');
    if (auth !== `Basic ${btoa(`${KEY_ID}:${KEY_SECRET}`)}`) return json({ error: {} }, 401);
    const body = typeof init?.body === 'string' ? init.body : '';
    if (body) this.bodies.push(body);
    if (method === 'POST' && url.pathname === '/v1/subscriptions') {
      const { plan_id, notes } = JSON.parse(body) as {
        plan_id: string;
        notes: Record<string, string>;
      };
      const sub: FakeSubscription = {
        id: `sub_Test${String(this.next++)}`,
        plan_id,
        status: 'created',
        current_end: null,
        paid_count: 0,
        payment_method: null,
        notes,
      };
      this.subscriptions.set(sub.id, sub);
      return json(sub);
    }
    const match = /^\/v1\/subscriptions\/(sub_\w+)(\/cancel)?$/.exec(url.pathname);
    const sub = match?.[1] ? this.subscriptions.get(match[1]) : undefined;
    if (!sub) return json({ error: {} }, 400);
    if (match?.[2]) sub.status = 'cancelled';
    await Promise.resolve();
    return json(sub);
  };

  /** What happens at Razorpay when the buyer pays, or a renewal charges. */
  charge(id: string, periodEnd: number) {
    const sub = this.get(id);
    sub.status = 'active';
    sub.paid_count += 1;
    sub.current_end = Math.floor(periodEnd / 1000);
    sub.payment_method = 'upi';
  }

  get(id: string): FakeSubscription {
    const sub = this.subscriptions.get(id);
    if (!sub) throw new Error(`no ${id}`);
    return sub;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let env: Env;
let sqlite: DatabaseSync;
let client: Client;
let keys: [Uint8Array, Uint8Array, Uint8Array];
let razorpay: FakeRazorpay;
let eventCount = 0;

beforeEach(async () => {
  const test = createTestDb();
  sqlite = test.sqlite;
  env = {
    DB: test.db,
    BLOBS: {} as R2Bucket,
    RAZORPAY_KEY_ID: KEY_ID,
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    RAZORPAY_PLANS: JSON.stringify(PLANS),
  };
  razorpay = new FakeRazorpay();
  vi.stubGlobal('fetch', razorpay.handle);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  keys = [newLoginKey(), newLoginKey(), newLoginKey()];
  client = new Client(env);
  const res = await client.request('POST', '/auth/signup', {
    email: EMAIL,
    name: 'Sam',
    keyring: await makeKeyring(keys),
  });
  expect(res.status).toBe(201);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function status(): Promise<BillingStatus> {
  const res = await client.request('GET', '/account/billing');
  expect(res.status).toBe(200);
  return res.json<BillingStatus>();
}

async function limit(): Promise<number> {
  const res = await client.request('GET', '/account/storage');
  return (await res.json<{ limit: number }>()).limit;
}

async function payments(): Promise<BillingPayment[]> {
  const res = await client.request('GET', '/account/billing/payments');
  return (await res.json<{ payments: BillingPayment[] }>()).payments;
}

async function subscribe(plan = 'plus', period = 'monthly'): Promise<Response> {
  return client.request('POST', '/account/billing/subscribe', { plan, period });
}

async function subscribed(plan = 'plus', period = 'monthly'): Promise<string> {
  const res = await subscribe(plan, period);
  expect([200, 201]).toContain(res.status);
  return (await res.json<SubscribeResponse>()).subscriptionId;
}

interface PaymentFields {
  id: string;
  amount?: number;
  status?: string;
  refunded?: number;
  currency?: string;
  at?: number;
}

/** A notification as Razorpay sends it, signed unless told otherwise. */
async function notify(
  event: string,
  subscriptionId: string | null,
  payment?: PaymentFields,
  options: { eventId?: string; secret?: string; tamper?: boolean } = {},
): Promise<Response> {
  const payload: Record<string, unknown> = {};
  if (subscriptionId) {
    // Deliberately stale: the server must fetch the real state, not trust this.
    payload.subscription = { entity: { id: subscriptionId, status: 'created', plan_id: 'x' } };
  }
  if (payment) {
    payload.payment = {
      entity: {
        id: payment.id,
        amount: payment.amount ?? PLUS_MONTHLY,
        amount_refunded: payment.refunded ?? 0,
        currency: payment.currency ?? 'INR',
        status: payment.status ?? 'captured',
        created_at: Math.floor((payment.at ?? Date.now()) / 1000),
      },
    };
  }
  const raw = JSON.stringify({ entity: 'event', event, contains: [], payload });
  const signature = await webhookSignature(options.secret ?? WEBHOOK_SECRET, raw);
  const sent = options.tamper ? raw.replace('"event"', '"event" ') : raw;
  return new Client(env).send('POST', '/billing/razorpay', sent, {
    'content-type': 'application/json',
    'x-razorpay-signature': signature,
    'x-razorpay-event-id': options.eventId ?? `evt_${String(++eventCount)}`,
  });
}

describe('subscribing', () => {
  it('starts a Razorpay subscription for Checkout without changing the plan', async () => {
    const res = await subscribe();
    expect(res.status).toBe(201);
    const body = await res.json<SubscribeResponse>();
    expect(body.keyId).toBe(KEY_ID);
    expect(razorpay.get(body.subscriptionId).plan_id).toBe('plan_PlusM');
    expect(await status()).toMatchObject({ plan: 'free', available: true });
    expect(await limit()).toBe(STORAGE_SIZES.accountQuota);
  });

  it('sends Razorpay only a random reference, never the account id, email or name', async () => {
    await subscribed();
    const accountId = (sqlite.prepare('SELECT id FROM accounts').get() as { id: string }).id;
    const sent = razorpay.bodies.join('\n');
    expect(sent).not.toContain(EMAIL);
    expect(sent).not.toContain(accountId);
    expect(sent).not.toContain('Sam');
    expect(sent).toMatch(/"notes":\{"ref":"c_[A-Za-z0-9_-]{22}"\}/);
  });

  it('hands back the same unpaid subscription when clicked twice', async () => {
    const first = await subscribed();
    const second = await subscribed();
    expect(second).toBe(first);
    expect(razorpay.subscriptions.size).toBe(1);
  });

  it('starts one subscription for two requests at once', async () => {
    const [a, b] = await Promise.all([subscribe(), subscribe()]);
    // Either the second waits its turn and gets the same one back, or it is told to retry.
    expect([
      [200, 201],
      [201, 409],
    ]).toContainEqual([a.status, b.status].sort());
    expect(razorpay.subscriptions.size).toBe(1);
  });

  it('turns a request away while another one for the account is running', async () => {
    await subscribed();
    sqlite.prepare('UPDATE billing_customers SET busy_until = ?').run(Date.now() + 10_000);
    const res = await subscribe('pro');
    expect(res.status).toBe(409);
    expect(razorpay.subscriptions.size).toBe(1);
  });

  it('cancels an unpaid subscription for another plan, so only one Checkout can be paid', async () => {
    const plus = await subscribed('plus');
    const pro = await subscribed('pro');
    expect(pro).not.toBe(plus);
    expect(razorpay.get(plus).status).toBe('cancelled');
    expect(razorpay.get(pro).status).toBe('created');
  });

  it('refuses a second plan while one is live, even if paid in another tab', async () => {
    const id = await subscribed();
    razorpay.charge(id, Date.now() + 30 * DAY);
    // No notification yet: the server asks Razorpay before reusing the unpaid one.
    expect((await subscribe('pro')).status).toBe(409);
    expect(razorpay.get(id).status).toBe('active');
    expect((await status()).plan).toBe('plus');
  });

  it('refuses yearly Max (a one-time payment, not a subscription) and unknown plans', async () => {
    expect((await subscribe('max', 'yearly')).status).toBe(400);
    expect((await subscribe('free', 'monthly')).status).toBe(400);
    expect((await subscribe('plus', 'weekly')).status).toBe(400);
    expect(razorpay.calls).toEqual([]);
  });

  it('says plans are unavailable until Razorpay is set up', async () => {
    delete env.RAZORPAY_PLANS;
    expect((await subscribe()).status).toBe(503);
    expect((await status()).available).toBe(false);
    env.RAZORPAY_PLANS = JSON.stringify({ ...PLANS, 'pro:yearly': 'not-a-plan' });
    expect((await subscribe()).status).toBe(503);
  });

  it('answers "try again" when Razorpay is unreachable, changing nothing', async () => {
    razorpay.down = true;
    const res = await subscribe();
    expect(res.status).toBe(502);
    razorpay.down = false;
    expect(await subscribed()).toMatch(/^sub_/);
  });

  it('needs a session', async () => {
    const res = await new Client(env).request('POST', '/account/billing/subscribe', {
      plan: 'plus',
      period: 'monthly',
    });
    expect(res.status).toBe(401);
  });
});

describe('Razorpay notifications', () => {
  it('turn the plan on once Razorpay says it is paid, even if the browser closed', async () => {
    const id = await subscribed();
    const end = Date.now() + 30 * DAY;
    razorpay.charge(id, end);
    expect((await notify('subscription.activated', id)).status).toBe(200);
    expect(await status()).toMatchObject({
      plan: 'plus',
      period: 'monthly',
      renews: true,
      paymentFailed: false,
    });
    expect((await status()).paidUntil).toBe(Math.floor(end / 1000) * 1000);
    expect(await limit()).toBe(PLAN_STORAGE.plus);
  });

  it('reject a wrong signature or a changed body, changing nothing', async () => {
    const id = await subscribed();
    razorpay.charge(id, Date.now() + 30 * DAY);
    const wrong = await notify(
      'subscription.charged',
      id,
      { id: 'pay_A' },
      { secret: 'x'.repeat(20) },
    );
    expect(wrong.status).toBe(400);
    const changed = await notify('subscription.charged', id, { id: 'pay_A' }, { tamper: true });
    expect(changed.status).toBe(400);
    const unsigned = await new Client(env).send('POST', '/billing/razorpay', '{}', {
      'content-type': 'application/json',
    });
    expect(unsigned.status).toBe(400);
    expect((await status()).plan).toBe('free');
    expect(await payments()).toEqual([]);
  });

  it('change nothing the second time the same notification comes', async () => {
    const id = await subscribed();
    razorpay.charge(id, Date.now() + 30 * DAY);
    await notify('subscription.charged', id, { id: 'pay_A' }, { eventId: 'evt_same' });
    const calls = razorpay.calls.length;
    expect(
      (await notify('subscription.charged', id, { id: 'pay_A' }, { eventId: 'evt_same' })).status,
    ).toBe(200);
    expect(razorpay.calls.length).toBe(calls);
    // The same payment under a new event id is still recorded once.
    await notify('subscription.charged', id, { id: 'pay_A' });
    expect(await payments()).toHaveLength(1);
  });

  it('never let an old notification undo a newer state, whatever the order', async () => {
    const id = await subscribed();
    const first = Date.now() + 30 * DAY;
    const second = first + 30 * DAY;
    razorpay.charge(id, first);
    razorpay.charge(id, second);
    // Charged arrives before activated, and both describe older states.
    await notify('subscription.charged', id, { id: 'pay_B' });
    await notify('subscription.activated', id);
    expect((await status()).paidUntil).toBe(Math.floor(second / 1000) * 1000);
    // Razorpay's own state moving back (it never should) can't shorten what was paid.
    razorpay.get(id).current_end = Math.floor(first / 1000);
    await notify('subscription.charged', id, { id: 'pay_A' });
    expect((await status()).paidUntil).toBe(Math.floor(second / 1000) * 1000);
  });

  it('keep the plan through a failed renewal with 7 days of grace, then fall back to Free', async () => {
    const id = await subscribed();
    const end = Date.now() + DAY;
    razorpay.charge(id, end);
    await notify('subscription.charged', id, { id: 'pay_A', at: Date.now() - DAY });
    razorpay.get(id).status = 'pending';
    await notify('subscription.pending', id, { id: 'pay_F', status: 'failed' });
    const pending = await status();
    expect(pending).toMatchObject({ plan: 'plus', paymentFailed: true, renews: false });
    expect(pending.graceUntil).toBe(Math.floor(end / 1000) * 1000 + GRACE_MS);
    // Halted after retries: grace is not extended again.
    razorpay.get(id).status = 'halted';
    await notify('subscription.halted', id);
    expect((await status()).graceUntil).toBe(pending.graceUntil);
    // Paid time and grace both over: Free, with nothing deleted.
    sqlite
      .prepare('UPDATE billing SET paid_until = ?, grace_until = ?')
      .run(Date.now() - 2, Date.now() - 1);
    expect(await status()).toMatchObject({ plan: 'free', paidUntil: null });
    expect(await limit()).toBe(STORAGE_SIZES.accountQuota);
    expect((await payments()).map((p) => p.status)).toEqual(['failed', 'paid']);
  });

  it('never drop the plan when a failed renewal then succeeds within grace', async () => {
    const id = await subscribed();
    const end = Date.now() + DAY;
    razorpay.charge(id, end);
    await notify('subscription.charged', id, { id: 'pay_A' });
    razorpay.get(id).status = 'pending';
    await notify('subscription.pending', id);
    razorpay.charge(id, end + 30 * DAY);
    await notify('subscription.charged', id, { id: 'pay_B' });
    expect(await status()).toMatchObject({ plan: 'plus', graceUntil: null, paymentFailed: false });
  });

  it('do not apply a payment whose amount or currency is not the plan’s price', async () => {
    const id = await subscribed();
    razorpay.charge(id, Date.now() + 30 * DAY);
    await notify('subscription.charged', id, { id: 'pay_A', amount: 100 });
    await notify('subscription.charged', id, { id: 'pay_B', currency: 'USD' });
    expect((await status()).plan).toBe('free');
    expect(console.error).toHaveBeenCalledWith(
      'Billing: payment does not match the plan’s price; plan not changed',
    );
  });

  it('do not apply a subscription Razorpay says is on another plan', async () => {
    const id = await subscribed();
    razorpay.charge(id, Date.now() + 30 * DAY);
    razorpay.get(id).plan_id = 'plan_MaxM';
    await notify('subscription.activated', id);
    expect((await status()).plan).toBe('free');
  });

  it('ignore subscriptions this server did not create', async () => {
    expect((await notify('subscription.activated', 'sub_Elsewhere')).status).toBe(200);
    expect(razorpay.calls).toEqual([]);
  });

  it('ask Razorpay to retry when it can’t be reached to check the state', async () => {
    const id = await subscribed();
    razorpay.charge(id, Date.now() + 30 * DAY);
    razorpay.down = true;
    expect(
      (await notify('subscription.activated', id, undefined, { eventId: 'evt_r' })).status,
    ).toBe(503);
    razorpay.down = false;
    expect(
      (await notify('subscription.activated', id, undefined, { eventId: 'evt_r' })).status,
    ).toBe(200);
    expect((await status()).plan).toBe('plus');
  });
});

describe('confirm after Checkout', () => {
  it('shows the new plan at once by asking Razorpay, not trusting the browser', async () => {
    const id = await subscribed();
    let res = await client.request('POST', '/account/billing/confirm', { subscriptionId: id });
    expect((await res.json<BillingStatus>()).plan).toBe('free');
    razorpay.charge(id, Date.now() + 30 * DAY);
    res = await client.request('POST', '/account/billing/confirm', { subscriptionId: id });
    expect((await res.json<BillingStatus>()).plan).toBe('plus');
  });

  it('refuses another account’s subscription', async () => {
    const id = await subscribed();
    razorpay.charge(id, Date.now() + 30 * DAY);
    const other = new Client(env);
    await other.request('POST', '/auth/signup', {
      email: 'alex@example.com',
      name: 'Alex',
      keyring: await makeKeyring([newLoginKey(), newLoginKey(), newLoginKey()]),
    });
    const res = await other.request('POST', '/account/billing/confirm', { subscriptionId: id });
    expect(res.status).toBe(404);
    expect((await status()).plan).toBe('free');
  });
});

describe('cancelling', () => {
  it('stops renewals at once but keeps the plan to the end of the paid period', async () => {
    const id = await subscribed();
    const end = Date.now() + 30 * DAY;
    razorpay.charge(id, end);
    await notify('subscription.activated', id);
    const res = await client.request('POST', '/account/billing/cancel', {});
    expect(res.status).toBe(200);
    expect(razorpay.get(id).status).toBe('cancelled');
    expect(await res.json<BillingStatus>()).toMatchObject({
      plan: 'plus',
      renews: false,
      paidUntil: Math.floor(end / 1000) * 1000,
    });
    // The cancelled notification arriving later changes nothing.
    await notify('subscription.cancelled', id);
    expect((await status()).paidUntil).toBe(Math.floor(end / 1000) * 1000);
  });

  it('keeps the paid time when cancelled before the paid notification arrived', async () => {
    const id = await subscribed();
    razorpay.charge(id, Date.now() + 30 * DAY);
    await client.request('POST', '/account/billing/confirm', { subscriptionId: id });
    sqlite.prepare('DELETE FROM billing').run();
    razorpay.get(id).status = 'cancelled';
    await notify('subscription.cancelled', id);
    expect((await status()).plan).toBe('plus');
  });

  it('lets a new plan be bought once the cancelled one has ended, never twice at once', async () => {
    const id = await subscribed();
    razorpay.charge(id, Date.now() + 30 * DAY);
    await notify('subscription.activated', id);
    await client.request('POST', '/account/billing/cancel', {});
    expect((await subscribe('pro')).status).toBe(409);
    sqlite.prepare('UPDATE billing SET paid_until = ?').run(Date.now() - 1);
    expect((await subscribe('pro')).status).toBe(201);
  });
});

describe('payment history', () => {
  it('numbers paid invoices in order per year, never for failed attempts', async () => {
    const id = await subscribed();
    razorpay.charge(id, Date.now() + 30 * DAY);
    const jan = Date.UTC(2027, 0, 10);
    await notify('subscription.charged', id, { id: 'pay_A', at: jan });
    await notify('subscription.pending', id, { id: 'pay_F', status: 'failed', at: jan + DAY });
    await notify('subscription.charged', id, { id: 'pay_B', at: jan + 2 * DAY });
    const list = await payments();
    expect(list.map((p) => [p.id, p.status, p.invoiceNumber])).toEqual([
      ['pay_B', 'paid', 'ARC-2027-00002'],
      ['pay_F', 'failed', null],
      ['pay_A', 'paid', 'ARC-2027-00001'],
    ]);
    expect(list[0]).toMatchObject({ plan: 'plus', period: 'monthly', amount: PLUS_MONTHLY });
  });

  it('gives two payments at once different numbers with no gap', async () => {
    const id = await subscribed();
    razorpay.charge(id, Date.now() + 30 * DAY);
    const at = Date.UTC(2027, 5, 1);
    await Promise.all(
      ['pay_A', 'pay_B', 'pay_C'].map((pay) => notify('subscription.charged', id, { id: pay, at })),
    );
    await notify('subscription.charged', id, { id: 'pay_A', at });
    const numbers = (await payments()).map((p) => p.invoiceNumber).sort();
    expect(numbers).toEqual(['ARC-2027-00001', 'ARC-2027-00002', 'ARC-2027-00003']);
  });

  it('marks a refund made in Razorpay’s dashboard', async () => {
    const id = await subscribed();
    razorpay.charge(id, Date.now() + 30 * DAY);
    await notify('subscription.charged', id, { id: 'pay_A' });
    await notify('refund.processed', null, { id: 'pay_A', status: 'refunded', refunded: 5000 });
    expect((await payments())[0]).toMatchObject({ status: 'paid', refunded: 5000 });
    await notify('refund.processed', null, {
      id: 'pay_A',
      status: 'refunded',
      refunded: PLUS_MONTHLY,
    });
    expect((await payments())[0]).toMatchObject({ status: 'refunded', refunded: PLUS_MONTHLY });
  });
});

describe('deleting the account', () => {
  it('cancels a live subscription first and keeps the payment records', async () => {
    const id = await subscribed();
    razorpay.charge(id, Date.now() + 30 * DAY);
    await notify('subscription.charged', id, { id: 'pay_A' });
    const res = await client.request('DELETE', '/account', { loginKey: toBase64Url(keys[0]) });
    expect(res.status).toBe(204);
    expect(razorpay.get(id).status).toBe('cancelled');
    const kept = sqlite
      .prepare('SELECT account_id, invoice_number FROM billing_payments')
      .all() as { account_id: string | null; invoice_number: string }[];
    expect(kept).toHaveLength(1);
    expect(kept[0]?.account_id).toBeNull();
    expect(kept[0]?.invoice_number).toMatch(/^ARC-/);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM billing').get()).toEqual({ n: 0 });
  });

  it('keeps the account if Razorpay can’t be reached to stop the subscription', async () => {
    const id = await subscribed();
    razorpay.charge(id, Date.now() + 30 * DAY);
    await notify('subscription.activated', id);
    razorpay.down = true;
    const res = await client.request('DELETE', '/account', { loginKey: toBase64Url(keys[0]) });
    expect(res.status).toBe(502);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: 1 });
  });
});
