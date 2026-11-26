import { DEFAULT_KDF } from '@arcafold/crypto';
import { randomBytes, toBase64Url } from '@arcafold/crypto/webcrypto';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import { EMAIL_OFF_ERROR } from '@arcafold/types';
import type {
  AccountResponse,
  Keyring,
  PreLoginResponse,
  SignUpTicketResponse,
} from '@arcafold/types';

import { MAX_SENDS_PER_ADDRESS } from './email-codes';
import type { Env } from './env';
import { DECOY_KDF } from './routes/auth';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';
import { createTestR2 } from './test/r2';

const SECRET = 'test-email-secret-that-is-long-enough-1234';
const EMAIL = 'new@example.com';

interface SentMail {
  to: string;
  subject: string;
  text: string;
}

class TestMailbox {
  sent: SentMail[] = [];

  send(message: SentMail): Promise<{ messageId: string }> {
    this.sent.push(message);
    return Promise.resolve({ messageId: String(this.sent.length) });
  }

  lastCode(to: string): string {
    const mail = this.sent.filter((m) => m.to === to).at(-1);
    const code = /\b(\d{6})\b/.exec(mail?.text ?? '')?.[1];
    if (!code) throw new Error(`No code was sent to ${to}`);
    return code;
  }
}

let env: Env;
let sqlite: DatabaseSync;
let mailbox: TestMailbox;
let client: Client;
let keyring: Keyring;

beforeEach(async () => {
  const db = createTestDb();
  sqlite = db.sqlite;
  mailbox = new TestMailbox();
  env = {
    DB: db.db,
    BLOBS: createTestR2().bucket,
    EMAIL: mailbox as unknown as SendEmail,
    EMAIL_CODE_SECRET: SECRET,
  };
  client = new Client(env);
  keyring = await makeKeyring([newLoginKey(), newLoginKey(), newLoginKey()]);
});

async function ticketFor(c: Client, email: string): Promise<string> {
  const sent = await c.request('POST', '/auth/signup/code', { email });
  expect(await sent.json()).toEqual({ codeSent: true });
  const res = await c.request('POST', '/auth/signup/verify', {
    email,
    code: mailbox.lastCode(email),
  });
  expect(res.status).toBe(200);
  return (await res.json<SignUpTicketResponse>()).ticket;
}

/** An account made the old way (email off), so the address is taken. */
async function existing(email: string): Promise<void> {
  const before = new Client({ DB: env.DB, BLOBS: env.BLOBS });
  const res = await before.request('POST', '/auth/signup', { email, name: 'Kim', keyring });
  expect(res.status).toBe(201);
}

describe('sign-up with an email code', () => {
  it('confirms the email, then makes an account that starts confirmed', async () => {
    const ticket = await ticketFor(client, EMAIL);
    const res = await client.request('POST', '/auth/signup', {
      email: EMAIL,
      name: 'Sam',
      keyring,
      ticket,
    });
    expect(res.status).toBe(201);
    expect(await res.json<AccountResponse>()).toMatchObject({
      email: EMAIL,
      emailVerified: true,
      mustVerifyEmail: false,
    });
    // Signed in straight away, and the library is open to it.
    expect((await client.request('PUT', '/account/name', { name: 'Sam R' })).status).toBe(200);
    // The ticket is used up.
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM email_codes WHERE tag != ?').get('')?.n).toBe(
      0,
    );
  });

  it('refuses sign-up without a ticket, with a made-up one, or with one for another email', async () => {
    const without = await client.request('POST', '/auth/signup', {
      email: EMAIL,
      name: 'Sam',
      keyring,
    });
    expect(without.status).toBe(400);
    const madeUp = await client.request('POST', '/auth/signup', {
      email: EMAIL,
      name: 'Sam',
      keyring,
      ticket: toBase64Url(randomBytes(32)),
    });
    expect(madeUp.status).toBe(400);
    const ticket = await ticketFor(client, EMAIL);
    const other = await client.request('POST', '/auth/signup', {
      email: 'other@example.com',
      name: 'Sam',
      keyring,
      ticket,
    });
    expect(other.status).toBe(400);
  });

  it('lets a ticket make only one account', async () => {
    const ticket = await ticketFor(client, EMAIL);
    const body = { email: EMAIL, name: 'Sam', keyring, ticket };
    expect((await client.request('POST', '/auth/signup', body)).status).toBe(201);
    expect((await new Client(env).request('POST', '/auth/signup', body)).status).toBe(400);
  });

  it('refuses an expired ticket', async () => {
    const ticket = await ticketFor(client, EMAIL);
    sqlite.prepare('UPDATE email_codes SET expires_at = 0').run();
    const res = await client.request('POST', '/auth/signup', {
      email: EMAIL,
      name: 'Sam',
      keyring,
      ticket,
    });
    expect(res.status).toBe(400);
  });

  it('refuses a wrong code, and stops after five tries', async () => {
    await client.request('POST', '/auth/signup/code', { email: EMAIL });
    const code = mailbox.lastCode(EMAIL);
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) {
      const res = await client.request('POST', '/auth/signup/verify', {
        email: EMAIL,
        code: wrong,
      });
      expect(res.status).toBe(400);
    }
    const res = await client.request('POST', '/auth/signup/verify', { email: EMAIL, code });
    expect(await res.json()).toEqual({ error: 'That code has run out. Ask for a new one.' });
  });

  it('only accepts a code for the address it went to', async () => {
    await client.request('POST', '/auth/signup/code', { email: EMAIL });
    const res = await client.request('POST', '/auth/signup/verify', {
      email: 'other@example.com',
      code: mailbox.lastCode(EMAIL),
    });
    expect(res.status).toBe(400);
  });

  it('waits a minute between codes for one email', async () => {
    expect((await client.request('POST', '/auth/signup/code', { email: EMAIL })).status).toBe(200);
    expect((await client.request('POST', '/auth/signup/code', { email: EMAIL })).status).toBe(429);
  });

  it('caps sign-up codes from one internet address', async () => {
    const from = { 'cf-connecting-ip': '203.0.113.9' };
    client.headers = from;
    for (let i = 0; i < MAX_SENDS_PER_ADDRESS; i++) {
      const res = await client.request('POST', '/auth/signup/code', {
        email: `p${String(i)}@example.com`,
      });
      expect(res.status).toBe(200);
    }
    const res = await client.request('POST', '/auth/signup/code', {
      email: 'one-more@example.com',
    });
    expect(res.status).toBe(429);
    // Another address isn't held back.
    client.headers = { 'cf-connecting-ip': '203.0.113.10' };
    expect(
      (await client.request('POST', '/auth/signup/code', { email: 'elsewhere@example.com' }))
        .status,
    ).toBe(200);
  });
});

describe('not telling who has an account', () => {
  it('answers sign-up the same for a taken email, and only its owner learns why', async () => {
    await existing(EMAIL);
    const res = await client.request('POST', '/auth/signup/code', { email: EMAIL });
    expect(res.status).toBe(200);
    const mail = mailbox.sent.at(-1);
    expect(mail?.to).toBe(EMAIL);
    expect(mail?.subject).toBe('You already have an Arcafold account');
    expect(mail?.text).not.toMatch(/\b\d{6}\b/);
    // No code works, so the sign-up can't go on.
    const verify = await client.request('POST', '/auth/signup/verify', {
      email: EMAIL,
      code: '123456',
    });
    expect(verify.status).toBe(400);
    expect(await verify.json()).toEqual({ error: 'That code isn’t right.' });
  });

  it('gives an unknown email a steady made-up salt with the usual settings', async () => {
    const first = await client.request('POST', '/auth/prelogin', { email: 'nobody@example.com' });
    expect(first.status).toBe(200);
    const salt = (await first.json<PreLoginResponse>()).salt;
    const again = await (
      await client.request('POST', '/auth/prelogin', { email: 'nobody@example.com' })
    ).json<PreLoginResponse>();
    expect(again).toEqual({ salt, kdf: DECOY_KDF });
    expect(salt).toHaveLength(keyring.salt.length);
    expect(DECOY_KDF).toEqual(DEFAULT_KDF);
    const login = await client.request('POST', '/auth/login', {
      email: 'nobody@example.com',
      loginKey: toBase64Url(newLoginKey()),
    });
    expect(login.status).toBe(401);
  });

  it('still gives a real account its own salt', async () => {
    await existing(EMAIL);
    const res = await client.request('POST', '/auth/prelogin', { email: EMAIL });
    expect((await res.json<PreLoginResponse>()).salt).toBe(keyring.salt);
  });
});

describe('with email off', () => {
  it('says so on the code routes, and signs up and answers prelogin as before', async () => {
    const plain = new Client({ DB: env.DB, BLOBS: env.BLOBS });
    const code = await plain.request('POST', '/auth/signup/code', { email: EMAIL });
    expect(code.status).toBe(200);
    expect(await code.json()).toEqual({ codeSent: false });
    expect(mailbox.sent).toEqual([]);
    const verify = await plain.request('POST', '/auth/signup/verify', {
      email: EMAIL,
      code: '123456',
    });
    expect(verify.status).toBe(503);
    expect(await verify.json()).toMatchObject({ code: EMAIL_OFF_ERROR });
    expect((await plain.request('POST', '/auth/prelogin', { email: EMAIL })).status).toBe(404);
    const res = await plain.request('POST', '/auth/signup', { email: EMAIL, name: 'Sam', keyring });
    expect(res.status).toBe(201);
    expect(await res.json<AccountResponse>()).toMatchObject({ emailVerified: false });
  });
});

describe('old email rows', () => {
  it('are cleared a day after they expire', async () => {
    await client.request('POST', '/auth/signup/code', { email: EMAIL });
    sqlite.prepare('UPDATE email_codes SET expires_at = 1').run();
    await client.request('POST', '/auth/signup/code', { email: 'other@example.com' });
    const rows = sqlite.prepare('SELECT expires_at FROM email_codes').all();
    for (const row of rows) expect(Number(row.expires_at)).toBeGreaterThan(1);
  });
});
