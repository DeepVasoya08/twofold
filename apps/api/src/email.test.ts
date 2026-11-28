import { randomBytes, toBase64Url } from '@arcafold/crypto/webcrypto';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import { SPACE_HEADER, VERIFY_EMAIL_ERROR } from '@arcafold/types';
import type { AccountResponse } from '@arcafold/types';

import type { Env } from './env';
import { MAX_SENDS_PER_HOUR } from './routes/email';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';
import { createTestR2 } from './test/r2';

const SECRET = 'test-email-secret-that-is-long-enough-1234';
const EMAIL = 'sam@example.com';

interface SentMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Stands in for the Email Service binding: keeps what was sent, or fails when told to. */
class TestMailbox {
  sent: SentMail[] = [];
  failing = false;

  send(message: SentMail): Promise<{ messageId: string }> {
    if (this.failing) return Promise.reject(new Error('E_DELIVERY_FAILED'));
    this.sent.push(message);
    return Promise.resolve({ messageId: String(this.sent.length) });
  }

  /** The code in the last email sent to `to`. */
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
let keys: [Uint8Array, Uint8Array, Uint8Array];

/**
 * Makes an unconfirmed account, as accounts made before email existed are: signed up with
 * email off, then signed in on `c`.
 */
async function signUp(c: Client, email: string, loginKeys = keys): Promise<void> {
  const keyring = await makeKeyring(loginKeys);
  const before = new Client({ DB: env.DB, BLOBS: env.BLOBS });
  const res = await before.request('POST', '/auth/signup', { email, name: 'Sam', keyring });
  expect(res.status).toBe(201);
  c.cookie = before.cookie;
}

/** Lets the resend wait pass, as if the last code was sent over a minute ago. */
function waitForResend(): void {
  sqlite.prepare('UPDATE email_codes SET sent_at = sent_at - 61000').run();
}

async function account(c: Client): Promise<AccountResponse> {
  return (await c.request('GET', '/account')).json<AccountResponse>();
}

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
  keys = [newLoginKey(), newLoginKey(), newLoginKey()];
  await signUp(client, EMAIL);
});

describe('an unconfirmed account', () => {
  it('is told to confirm its email', async () => {
    expect(await account(client)).toMatchObject({
      email: EMAIL,
      emailVerified: false,
      mustVerifyEmail: true,
    });
  });

  it('is refused everything else by the server until it does', async () => {
    const rename = await client.request('PUT', '/account/name', { name: 'Kim' });
    expect(rename.status).toBe(403);
    expect(await rename.json()).toEqual({
      error: 'Confirm your email to keep going.',
      code: VERIFY_EMAIL_ERROR,
    });
    expect((await client.request('GET', '/account/devices')).status).toBe(403);
    expect((await client.request('GET', '/invites/pending')).status).toBe(403);
    client.headers = { [SPACE_HEADER]: toBase64Url(randomBytes(16)) };
    expect((await client.request('GET', '/space/photos')).status).toBe(403);
  });

  it('can still sign out', async () => {
    expect((await client.request('POST', '/auth/logout', {})).status).toBe(204);
  });

  it('is not asked while email is not set up, and the routes say so', async () => {
    const plain = { DB: env.DB, BLOBS: env.BLOBS };
    const other = new Client(plain);
    await signUp(other, 'kim@example.com', [newLoginKey(), newLoginKey(), newLoginKey()]);
    expect(await account(other)).toMatchObject({ emailVerified: false, mustVerifyEmail: false });
    expect((await other.request('PUT', '/account/name', { name: 'Kim' })).status).toBe(200);
    const res = await other.request('POST', '/account/email/code', { email: 'kim@example.com' });
    expect(res.status).toBe(503);
  });

  it('is not asked while the secret is too short to use', async () => {
    const other = new Client({ ...env, EMAIL_CODE_SECRET: 'short' });
    other.cookie = client.cookie;
    expect(await account(other)).toMatchObject({ mustVerifyEmail: false });
  });
});

describe('confirming the account’s email', () => {
  it('sends a code that confirms it and lifts the lock', async () => {
    expect((await client.request('POST', '/account/email/code', { email: EMAIL })).status).toBe(
      204,
    );
    expect(mailbox.sent).toHaveLength(1);
    const mail = mailbox.sent[0];
    expect(mail?.to).toBe(EMAIL);
    const code = mailbox.lastCode(EMAIL);
    expect(mail?.subject).toBe(`${code} is your Arcafold code`);
    expect(mail?.html).toContain(code);
    expect(mail?.text).toContain('never email you a link to unlock your photos');
    expect(mail?.text.toLowerCase()).not.toContain('private');

    const res = await client.request('POST', '/account/email/verify', { email: EMAIL, code });
    expect(res.status).toBe(200);
    expect(await res.json<AccountResponse>()).toMatchObject({
      email: EMAIL,
      emailVerified: true,
      mustVerifyEmail: false,
    });
    expect((await client.request('PUT', '/account/name', { name: 'Kim' })).status).toBe(200);
    // A used code is gone.
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM email_codes').get()?.n).toBe(0);
  });

  it('keeps no code, account id or address in readable form', async () => {
    await client.request('POST', '/account/email/code', { email: EMAIL });
    const code = mailbox.lastCode(EMAIL);
    const row = sqlite.prepare('SELECT * FROM email_codes').get() as Record<string, unknown>;
    const stored = JSON.stringify({ ...row, account_id: null });
    expect(stored).not.toContain(code);
    expect(stored).not.toContain(EMAIL);
    const id = sqlite.prepare('SELECT id FROM accounts').get()?.id as string;
    expect(stored).not.toContain(id);
  });

  it('refuses a wrong code', async () => {
    await client.request('POST', '/account/email/code', { email: EMAIL });
    const code = mailbox.lastCode(EMAIL);
    const wrong = code === '000000' ? '000001' : '000000';
    const res = await client.request('POST', '/account/email/verify', {
      email: EMAIL,
      code: wrong,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'That code isn’t right.' });
    expect(await account(client)).toMatchObject({ emailVerified: false });
  });

  it('stops after five wrong tries, even for the right code', async () => {
    await client.request('POST', '/account/email/code', { email: EMAIL });
    const code = mailbox.lastCode(EMAIL);
    const wrong = code === '000000' ? '000001' : '000000';
    const tries = await Promise.all(
      Array.from({ length: 5 }, () =>
        client.request('POST', '/account/email/verify', { email: EMAIL, code: wrong }),
      ),
    );
    for (const res of tries) expect(res.status).toBe(400);
    const res = await client.request('POST', '/account/email/verify', { email: EMAIL, code });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'That code has run out. Ask for a new one.' });
  });

  it('refuses an expired code', async () => {
    await client.request('POST', '/account/email/code', { email: EMAIL });
    sqlite.prepare('UPDATE email_codes SET expires_at = 0').run();
    const res = await client.request('POST', '/account/email/verify', {
      email: EMAIL,
      code: mailbox.lastCode(EMAIL),
    });
    expect(res.status).toBe(400);
  });

  it('refuses a code without one being sent, and malformed codes', async () => {
    const none = await client.request('POST', '/account/email/verify', {
      email: EMAIL,
      code: '123456',
    });
    expect(none.status).toBe(400);
    for (const code of ['12345', '1234567', 'abcdef', '']) {
      const res = await client.request('POST', '/account/email/verify', { email: EMAIL, code });
      expect(res.status).toBe(400);
    }
  });

  it('only accepts the newest code', async () => {
    await client.request('POST', '/account/email/code', { email: EMAIL });
    const first = mailbox.lastCode(EMAIL);
    waitForResend();
    await client.request('POST', '/account/email/code', { email: EMAIL });
    const second = mailbox.lastCode(EMAIL);
    if (first !== second) {
      const res = await client.request('POST', '/account/email/verify', {
        email: EMAIL,
        code: first,
      });
      expect(res.status).toBe(400);
    }
    const res = await client.request('POST', '/account/email/verify', {
      email: EMAIL,
      code: second,
    });
    expect(res.status).toBe(200);
  });

  it('waits a minute between codes, and caps codes per hour', async () => {
    expect((await client.request('POST', '/account/email/code', { email: EMAIL })).status).toBe(
      204,
    );
    const soon = await client.request('POST', '/account/email/code', { email: EMAIL });
    expect(soon.status).toBe(429);
    for (let i = 1; i < MAX_SENDS_PER_HOUR; i++) {
      waitForResend();
      expect((await client.request('POST', '/account/email/code', { email: EMAIL })).status).toBe(
        204,
      );
    }
    waitForResend();
    const tooMany = await client.request('POST', '/account/email/code', { email: EMAIL });
    expect(tooMany.status).toBe(429);
    expect(mailbox.sent).toHaveLength(MAX_SENDS_PER_HOUR);
    // An hour later it can send again.
    sqlite.prepare('UPDATE email_codes SET sends_since = sends_since - 3600000').run();
    expect((await client.request('POST', '/account/email/code', { email: EMAIL })).status).toBe(
      204,
    );
  });

  it('sends only one code when two requests race', async () => {
    const both = await Promise.all([
      client.request('POST', '/account/email/code', { email: EMAIL }),
      client.request('POST', '/account/email/code', { email: EMAIL }),
    ]);
    expect(both.map((res) => res.status).sort()).toEqual([204, 429]);
    expect(mailbox.sent).toHaveLength(1);
  });

  it('says so when the email could not be sent', async () => {
    mailbox.failing = true;
    const res = await client.request('POST', '/account/email/code', { email: EMAIL });
    expect(res.status).toBe(502);
  });

  it('does nothing more for an account that is already confirmed', async () => {
    await client.request('POST', '/account/email/code', { email: EMAIL });
    await client.request('POST', '/account/email/verify', {
      email: EMAIL,
      code: mailbox.lastCode(EMAIL),
    });
    const again = await client.request('POST', '/account/email/code', { email: EMAIL });
    expect(again.status).toBe(409);
    const verify = await client.request('POST', '/account/email/verify', {
      email: EMAIL,
      code: '123456',
    });
    expect(verify.status).toBe(200);
  });

  it('needs a session', async () => {
    const stranger = new Client(env);
    expect((await stranger.request('POST', '/account/email/code', { email: EMAIL })).status).toBe(
      401,
    );
  });

  it('forgets pending codes when the account is deleted', async () => {
    await client.request('POST', '/account/email/code', { email: EMAIL });
    sqlite.prepare('DELETE FROM sessions').run();
    sqlite.prepare('DELETE FROM accounts').run();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM email_codes').get()?.n).toBe(0);
  });
});

describe('confirming a different email instead', () => {
  const NEW = 'sam.new@example.com';
  const loginKey = () => toBase64Url(keys[0]);

  it('needs the login key, and refuses a wrong one', async () => {
    const none = await client.request('POST', '/account/email/code', { email: NEW });
    expect(none.status).toBe(400);
    const wrong = await client.request('POST', '/account/email/code', {
      email: NEW,
      loginKey: toBase64Url(newLoginKey()),
    });
    expect(wrong.status).toBe(403);
    expect(mailbox.sent).toHaveLength(0);
  });

  it('accepts the private or recovery key too, the same way', async () => {
    const res = await client.request('POST', '/account/email/code', {
      email: NEW,
      loginKey: toBase64Url(keys[2]),
    });
    expect(res.status).toBe(204);
  });

  it('moves the account to the new address once its code is typed', async () => {
    const res = await client.request('POST', '/account/email/code', {
      email: NEW,
      loginKey: loginKey(),
    });
    expect(res.status).toBe(204);
    expect(mailbox.sent.map((m) => m.to)).toEqual([NEW]);
    const verified = await client.request('POST', '/account/email/verify', {
      email: NEW,
      code: mailbox.lastCode(NEW),
    });
    expect(await verified.json<AccountResponse>()).toMatchObject({
      email: NEW,
      emailVerified: true,
    });
    // Logging in uses the new address from now on.
    const login = await new Client(env).request('POST', '/auth/login', {
      email: NEW,
      loginKey: loginKey(),
    });
    expect(login.status).toBe(200);
  });

  it('only accepts the code for the address it was sent to', async () => {
    await client.request('POST', '/account/email/code', { email: NEW, loginKey: loginKey() });
    const res = await client.request('POST', '/account/email/verify', {
      email: EMAIL,
      code: mailbox.lastCode(NEW),
    });
    expect(res.status).toBe(400);
    expect(await account(client)).toMatchObject({ email: EMAIL, emailVerified: false });
  });

  it('sends a note instead of a code to an address that has an account, and answers the same', async () => {
    const owner = new Client(env);
    await signUp(owner, 'kim@example.com', [newLoginKey(), newLoginKey(), newLoginKey()]);
    const res = await client.request('POST', '/account/email/code', {
      email: 'kim@example.com',
      loginKey: loginKey(),
    });
    expect(res.status).toBe(204);
    const mail = mailbox.sent.at(-1);
    expect(mail?.to).toBe('kim@example.com');
    expect(mail?.subject).toBe('This email already has an Arcafold account');
    expect(mail?.text).not.toMatch(/\b\d{6}\b/);
  });

  /** Other accounts, each signed in with its own login key. */
  async function others(count: number): Promise<{ c: Client; loginKey: string }[]> {
    const made = [];
    for (let i = 0; i < count; i++) {
      const c = new Client(env);
      const theirKeys: [Uint8Array, Uint8Array, Uint8Array] = [
        newLoginKey(),
        newLoginKey(),
        newLoginKey(),
      ];
      await signUp(c, `someone${String(i)}@example.com`, theirKeys);
      made.push({ c, loginKey: toBase64Url(theirKeys[0]) });
    }
    return made;
  }

  const ask = (one: { c: Client; loginKey: string }, email: string) =>
    one.c.request('POST', '/account/email/code', { email, loginKey: one.loginKey });

  it('limits codes to one new address across all accounts, as sign-up does', async () => {
    const accounts = await others(MAX_SENDS_PER_HOUR + 1);
    const last = accounts[MAX_SENDS_PER_HOUR];
    if (!last) throw new Error('No account');
    for (const one of accounts.slice(0, MAX_SENDS_PER_HOUR)) {
      expect((await ask(one, NEW)).status).toBe(204);
    }
    const refused = await ask(last, NEW);
    expect(refused.status).toBe(429);
    expect((await refused.json<{ error: string }>()).error).toMatch(/a lot of codes/);
    expect(mailbox.sent.filter((m) => m.to === NEW)).toHaveLength(MAX_SENDS_PER_HOUR);
    // Other addresses aren't held up by it.
    expect((await ask(last, 'lee@example.com')).status).toBe(204);
    // An hour later the address can get codes again.
    sqlite.prepare('UPDATE email_codes SET sends_since = sends_since - 3600000').run();
    waitForResend();
    expect((await ask(last, NEW)).status).toBe(204);
  });

  it('limits notes to an address with an account the same way, so the limit tells nothing', async () => {
    await signUp(new Client(env), 'kim@example.com', [newLoginKey(), newLoginKey(), newLoginKey()]);
    const accounts = await others(MAX_SENDS_PER_HOUR + 1);
    const statuses = async (email: string) => {
      const seen = [];
      for (const one of accounts) seen.push((await ask(one, email)).status);
      return seen;
    };
    const taken = await statuses('kim@example.com');
    waitForResend();
    expect(await statuses(NEW)).toEqual(taken);
    expect(taken.at(-1)).toBe(429);
  });

  it('can’t be raced past the limit for one address', async () => {
    const accounts = await others(MAX_SENDS_PER_HOUR * 3);
    const results = await Promise.all(accounts.map((one) => ask(one, NEW)));
    expect(results.filter((res) => res.status === 204)).toHaveLength(MAX_SENDS_PER_HOUR);
    expect(results.filter((res) => res.status === 429)).toHaveLength(MAX_SENDS_PER_HOUR * 2);
    expect(mailbox.sent.filter((m) => m.to === NEW)).toHaveLength(MAX_SENDS_PER_HOUR);
  });
});

describe('the phone’s background backup', () => {
  it('keeps uploading while the email waits to be confirmed', async () => {
    const plain = new Client({ DB: env.DB, BLOBS: env.BLOBS });
    plain.cookie = client.cookie;
    plain.headers = { [SPACE_HEADER]: toBase64Url(randomBytes(16)) };
    const uploadToken = toBase64Url(randomBytes(16));
    const made = await plain.request('POST', '/space/upload-tokens', {
      id: toBase64Url(randomBytes(16)),
      token: uploadToken,
    });
    expect(made.status).toBe(201);

    client.headers = { [SPACE_HEADER]: uploadToken };
    const photo = {
      id: toBase64Url(randomBytes(16)),
      meta: toBase64Url(randomBytes(300)),
      thumbSize: 100,
      fullSize: 1000,
    };
    expect((await client.request('POST', '/space/photos', photo)).status).toBe(201);
  });
});
