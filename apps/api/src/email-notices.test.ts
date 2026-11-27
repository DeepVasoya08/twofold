import { toBase64Url } from '@arcafold/crypto/webcrypto';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AccountResponse, SignUpTicketResponse } from '@arcafold/types';

import type { Env } from './env';
import { emailInUseMail, mailTime, maskEmail, newSignInMail } from './mail-templates';
import { describePlace } from './request-info';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';
import { createTestR2 } from './test/r2';

const SECRET = 'test-email-secret-that-is-long-enough-1234';
const EMAIL = 'sam@example.com';
const NEW = 'sam.new@example.com';
const PHONE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

interface SentMail {
  to: string;
  subject: string;
  text: string;
  html: string;
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
let mailbox: TestMailbox;
let client: Client;
let keys: [Uint8Array, Uint8Array, Uint8Array];

/** A confirmed account, signed up with a code as new accounts are. */
beforeEach(async () => {
  const db = createTestDb();
  mailbox = new TestMailbox();
  env = {
    DB: db.db,
    BLOBS: createTestR2().bucket,
    EMAIL: mailbox as unknown as SendEmail,
    EMAIL_CODE_SECRET: SECRET,
  };
  client = new Client(env);
  keys = [newLoginKey(), newLoginKey(), newLoginKey()];
  await client.request('POST', '/auth/signup/code', { email: EMAIL });
  const verified = await client.request('POST', '/auth/signup/verify', {
    email: EMAIL,
    code: mailbox.lastCode(EMAIL),
  });
  const { ticket } = await verified.json<SignUpTicketResponse>();
  const keyring = await makeKeyring(keys);
  const res = await client.request('POST', '/auth/signup', {
    email: EMAIL,
    name: 'Sam',
    keyring,
    ticket,
  });
  expect(res.status).toBe(201);
  mailbox.sent = [];
});

describe('changing a confirmed email', () => {
  it('needs the login key, then a code at the new address', async () => {
    const without = await client.request('POST', '/account/email/code', { email: NEW });
    expect(without.status).toBe(400);
    const wrong = await client.request('POST', '/account/email/code', {
      email: NEW,
      loginKey: toBase64Url(newLoginKey()),
    });
    expect(wrong.status).toBe(403);
    expect(mailbox.sent).toEqual([]);
  });

  it('moves the account once the code is typed, and tells the old address', async () => {
    await client.request('POST', '/account/email/code', {
      email: NEW,
      loginKey: toBase64Url(keys[0]),
    });
    expect(mailbox.sent.map((m) => m.to)).toEqual([NEW]);
    const res = await client.request('POST', '/account/email/verify', {
      email: NEW,
      code: mailbox.lastCode(NEW),
    });
    expect(await res.json<AccountResponse>()).toMatchObject({ email: NEW, emailVerified: true });

    const notice = mailbox.sent.at(-1);
    expect(notice?.to).toBe(EMAIL);
    expect(notice?.subject).toBe('Your Arcafold email was changed');
    expect(notice?.text).toContain('s•••@example.com');
    expect(notice?.text).not.toContain(NEW);
    // No link that could change the account back (or into someone else's hands).
    expect(notice?.text).not.toMatch(/https?:\/\//);
    expect(notice?.html).not.toMatch(/href=/);
  });

  it('leaves the email as it is until the code is typed', async () => {
    await client.request('POST', '/account/email/code', {
      email: NEW,
      loginKey: toBase64Url(keys[0]),
    });
    const account = await (await client.request('GET', '/account')).json<AccountResponse>();
    expect(account).toMatchObject({ email: EMAIL, emailVerified: true, mustVerifyEmail: false });
    expect(mailbox.sent.some((m) => m.to === EMAIL)).toBe(false);
  });
});

describe('new sign-in emails', () => {
  async function logIn(loginKey: Uint8Array): Promise<SentMail | undefined> {
    const device = new Client(env);
    device.headers = { 'user-agent': PHONE_UA };
    const res = await device.request('POST', '/auth/login', {
      email: EMAIL,
      loginKey: toBase64Url(loginKey),
    });
    expect(res.status).toBe(200);
    return mailbox.sent.at(-1);
  }

  it('tells the owner which kind of device signed in, and when', async () => {
    const mail = await logIn(keys[0]);
    expect(mail?.to).toBe(EMAIL);
    expect(mail?.subject).toBe('New sign-in to Arcafold');
    expect(mail?.text).toContain('Chrome on Android');
    expect(mail?.text).toMatch(/\d{2}:\d{2} UTC/);
  });

  it('is the same whichever password or key signed in', async () => {
    const withoutTime = (mail: SentMail | undefined) =>
      mail?.text.replace(/\d+ \w{3} \d{4}, \d{2}:\d{2} UTC/, 'TIME');
    const main = withoutTime(await logIn(keys[0]));
    const recovery = withoutTime(await logIn(keys[1]));
    const other = withoutTime(await logIn(keys[2]));
    expect(recovery).toBe(main);
    expect(other).toBe(main);
    for (const mail of mailbox.sent) expect(mail.text.toLowerCase()).not.toContain('private');
  });

  it('isn’t sent for a wrong password', async () => {
    const res = await new Client(env).request('POST', '/auth/login', {
      email: EMAIL,
      loginKey: toBase64Url(newLoginKey()),
    });
    expect(res.status).toBe(401);
    expect(mailbox.sent).toEqual([]);
  });

  it('isn’t sent to an address that was never confirmed', async () => {
    const plain = new Client({ DB: env.DB, BLOBS: env.BLOBS });
    const other = [newLoginKey(), newLoginKey(), newLoginKey()] as const;
    await plain.request('POST', '/auth/signup', {
      email: 'old@example.com',
      name: 'Old',
      keyring: await makeKeyring([...other]),
    });
    await new Client(env).request('POST', '/auth/login', {
      email: 'old@example.com',
      loginKey: toBase64Url(other[0]),
    });
    expect(mailbox.sent).toEqual([]);
  });
});

describe('deleting the account', () => {
  it('confirms by email once it’s gone', async () => {
    const res = await client.request('DELETE', '/account', { loginKey: toBase64Url(keys[0]) });
    expect(res.status).toBe(204);
    expect(mailbox.sent.at(-1)).toMatchObject({
      to: EMAIL,
      subject: 'Your Arcafold account was deleted',
    });
  });

  it('sends nothing when the password is wrong', async () => {
    const res = await client.request('DELETE', '/account', {
      loginKey: toBase64Url(newLoginKey()),
    });
    expect(res.status).toBe(403);
    expect(mailbox.sent).toEqual([]);
  });
});

describe('mail helpers', () => {
  it('hide most of an address', () => {
    expect(maskEmail('sam@example.com')).toBe('s•••@example.com');
    expect(maskEmail('a@b.co')).toBe('a•••@b.co');
    expect(maskEmail('nonsense')).toBe('•••');
  });

  it('name a rough place from Cloudflare’s guess, or nothing', () => {
    expect(describePlace({ city: 'Mumbai', country: 'IN' })).toBe('Mumbai, India');
    expect(describePlace({ country: 'DE' })).toBe('Germany');
    expect(describePlace({ city: 'Somewhere', country: 'T1' })).toBeNull();
    expect(describePlace({ country: 'XX' })).toBeNull();
    expect(describePlace({ country: '<b>' })).toBeNull();
    expect(describePlace(undefined)).toBeNull();
  });

  it('show the device, place and time, escaped, and the logo', () => {
    const info = {
      device: 'Chrome on Android',
      place: 'Pune, <India>',
      when: Date.UTC(2026, 10, 27, 8, 5),
    };
    const mail = newSignInMail('sam@example.com', info);
    expect(mail.text).toContain('Device: Chrome on Android');
    expect(mail.text).toContain('Location: Near Pune, <India>');
    expect(mail.text).toContain('Time: 27 Nov 2026, 08:05 UTC');
    expect(mail.html).toContain('Pune, &lt;India&gt;');
    expect(mail.html).toContain('src="https://arcafold.com/icon-192.png"');
    const note = emailInUseMail('sam@example.com', { ...info, place: null });
    expect(note.text).toContain('Device: Chrome on Android');
    expect(note.text).not.toContain('Location');
  });

  it('write times in UTC', () => {
    expect(mailTime(Date.UTC(2026, 10, 26, 9, 5))).toBe('26 Nov 2026, 09:05 UTC');
  });
});
