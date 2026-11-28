import { toBase64Url } from '@arcafold/crypto/webcrypto';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AccountResponse, Keyring } from '@arcafold/types';

import type { Env } from './env';
import { MAX_EMAIL_FAILURES, MAX_FAILURES } from './proof';
import { createTestDb } from './test/d1';
import type { RoundTrips } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';

let env: Env;
let sqlite: DatabaseSync;
let client: Client;
let keys: [Uint8Array, Uint8Array, Uint8Array];
let keyring: Keyring;
let trips: RoundTrips;

const EMAIL = 'someone@example.com';

beforeEach(async () => {
  const test = createTestDb();
  sqlite = test.sqlite;
  trips = test.trips;
  env = { DB: test.db, BLOBS: {} as R2Bucket };
  client = new Client(env);
  keys = [newLoginKey(), newLoginKey(), newLoginKey()];
  keyring = await makeKeyring(keys);
});

async function signUp(c = client, email = EMAIL) {
  return c.request('POST', '/auth/signup', { email, name: 'Sam', keyring });
}

describe('POST /api/auth/signup', () => {
  it('creates the account and starts a session', async () => {
    const res = await signUp();
    expect(res.status).toBe(201);
    const body = await res.json<AccountResponse>();
    expect(body).toEqual({
      email: EMAIL,
      name: 'Sam',
      smartFeatures: null,
      version: 1,
      keyring,
      emailVerified: false,
      mustVerifyEmail: false,
    });
    expect(res.headers.get('set-cookie')).toMatch(
      /^__Host-arcafold_session=[\w-]{43}; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Strict$/,
    );
    expect((await client.request('GET', '/account')).status).toBe(200);
  });

  it('stores only a hash of the session token', async () => {
    await signUp();
    const token = client.cookie?.split('=')[1];
    const rows = sqlite.prepare('SELECT token_hash FROM sessions').all() as {
      token_hash: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).not.toBe(token);
  });

  it('normalises the email', async () => {
    await client.request('POST', '/auth/signup', {
      email: '  SomeOne@Example.com ',
      name: 'Sam',
      keyring,
    });
    const res = await new Client(env).request('POST', '/auth/prelogin', { email: EMAIL });
    expect(res.status).toBe(200);
  });

  it('refuses a taken email', async () => {
    await signUp();
    const res = await signUp(new Client(env));
    expect(res.status).toBe(409);
  });

  it.each([
    ['a bad email', { email: 'nope', name: 'Sam' }],
    ['an empty name', { email: EMAIL, name: '  ' }],
    ['an extra field', { email: EMAIL, name: 'Sam', password: 'hunter2' }],
  ])('rejects %s', async (_, fields) => {
    const res = await client.request('POST', '/auth/signup', { ...fields, keyring });
    expect(res.status).toBe(400);
  });

  it('rejects malformed or weak keyrings', async () => {
    const bad: Keyring[] = [
      { ...keyring, salt: 'short' },
      { ...keyring, kdf: { opsLimit: 1, memLimit: 1024 } },
      {
        ...keyring,
        slots: [keyring.slots[0], keyring.slots[1], 'x'.repeat(118)].map((s) =>
          s.replace('x', '+'),
        ) as Keyring['slots'],
      },
      {
        ...keyring,
        verifiers: [keyring.verifiers[0], keyring.verifiers[1]] as unknown as Keyring['verifiers'],
      },
    ];
    for (const candidate of bad) {
      const res = await client.request('POST', '/auth/signup', {
        email: EMAIL,
        name: 'Sam',
        keyring: candidate,
      });
      expect(res.status).toBe(400);
    }
  });

  it('requires a JSON content type', async () => {
    const { app } = await import('./app');
    const res = await app.request(
      'https://arcafold.test/api/auth/signup',
      {
        method: 'POST',
        body: JSON.stringify({ email: EMAIL, name: 'Sam', keyring }),
        headers: { 'content-type': 'text/plain' },
      },
      env,
    );
    expect(res.status).toBe(415);
  });
});

describe('POST /api/auth/prelogin', () => {
  it('returns the salt and KDF settings, nothing else', async () => {
    await signUp();
    const res = await new Client(env).request('POST', '/auth/prelogin', { email: EMAIL });
    expect(await res.json()).toEqual({ salt: keyring.salt, kdf: keyring.kdf });
  });

  it('answers 404 for an unknown email', async () => {
    const res = await client.request('POST', '/auth/prelogin', { email: 'nobody@example.com' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await signUp(new Client(env));
  });

  const login = (loginKey: Uint8Array, email = EMAIL) =>
    client.request('POST', '/auth/login', { email, loginKey: toBase64Url(loginKey) });

  it.each([0, 1, 2])('accepts the login key of slot %i with the same response', async (slot) => {
    const res = await login(keys[slot] ?? new Uint8Array());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: EMAIL,
      name: 'Sam',
      smartFeatures: null,
      emailVerified: false,
      mustVerifyEmail: false,
      version: 1,
      keyring,
    });
    expect(client.cookie).toMatch(/^__Host-arcafold_session=/);
  });

  it('refuses a wrong key and an unknown email the same way', async () => {
    const wrong = await login(newLoginKey());
    const unknown = await login(keys[0], 'nobody@example.com');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(client.cookie).toBeNull();
  });

  it('throttles after too many failures, even for the right key', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) expect((await login(newLoginKey())).status).toBe(401);
    expect((await login(keys[0])).status).toBe(429);
  });

  it('can’t be raced: parallel guesses get no more than the limit', async () => {
    const results = await Promise.all(
      Array.from({ length: MAX_FAILURES * 3 }, () => new Client(env)).map((c) =>
        c.request('POST', '/auth/login', { email: EMAIL, loginKey: toBase64Url(newLoginKey()) }),
      ),
    );
    const statuses = results.map((res) => res.status);
    expect(statuses.filter((status) => status === 401)).toHaveLength(MAX_FAILURES);
    expect(statuses.filter((status) => status === 429)).toHaveLength(MAX_FAILURES * 2);
    expect((await login(keys[0])).status).toBe(429);
  });

  it('only throttles the address the guesses came from', async () => {
    const from = (address: string, loginKey: Uint8Array) =>
      new Client(env).send(
        'POST',
        '/auth/login',
        JSON.stringify({ email: EMAIL, loginKey: toBase64Url(loginKey) }),
        { 'content-type': 'application/json', 'cf-connecting-ip': address },
      );
    for (let i = 0; i < MAX_FAILURES; i++) {
      expect((await from('203.0.113.9', newLoginKey())).status).toBe(401);
    }
    expect((await from('203.0.113.9', keys[0])).status).toBe(429);
    expect((await from('198.51.100.7', keys[0])).status).toBe(200);
  });

  it('stops guesses spread over many addresses at a ceiling per email', async () => {
    const from = (address: string, loginKey: Uint8Array) =>
      new Client(env).send(
        'POST',
        '/auth/login',
        JSON.stringify({ email: EMAIL, loginKey: toBase64Url(loginKey) }),
        { 'content-type': 'application/json', 'cf-connecting-ip': address },
      );
    for (let i = 0; i < MAX_EMAIL_FAILURES; i++) {
      const address = `192.0.2.${String(Math.floor(i / MAX_FAILURES))}`;
      expect((await from(address, newLoginKey())).status).toBe(401);
    }
    expect((await from('198.51.100.7', keys[0])).status).toBe(429);
  });

  it('doesn’t let one address use up the ceiling and lock everyone out', async () => {
    const from = (address: string, loginKey: Uint8Array) =>
      new Client(env).send(
        'POST',
        '/auth/login',
        JSON.stringify({ email: EMAIL, loginKey: toBase64Url(loginKey) }),
        { 'content-type': 'application/json', 'cf-connecting-ip': address },
      );
    for (let i = 0; i < MAX_EMAIL_FAILURES + 5; i++) await from('203.0.113.9', newLoginKey());
    expect((await from('203.0.113.9', keys[0])).status).toBe(429);
    expect((await from('198.51.100.7', keys[0])).status).toBe(200);
  });

  it('counts IPv6 addresses by their first 64 bits', async () => {
    const from = (address: string, loginKey: Uint8Array) =>
      new Client(env).send(
        'POST',
        '/auth/login',
        JSON.stringify({ email: EMAIL, loginKey: toBase64Url(loginKey) }),
        { 'content-type': 'application/json', 'cf-connecting-ip': address },
      );
    for (let i = 0; i < MAX_FAILURES; i++) {
      // A new address each time, all in one /64, as anyone given a /64 could send.
      const address = `2001:db8:1:2:${(i + 1).toString(16)}::1`;
      expect((await from(address, newLoginKey())).status).toBe(401);
    }
    expect((await from('2001:db8:1:2:ffff::9', keys[0])).status).toBe(429);
    expect((await from('2001:db8:1:3::1', keys[0])).status).toBe(200);
  });

  it('keeps no address in readable form, and forgets finished windows', async () => {
    await new Client(env).send(
      'POST',
      '/auth/login',
      JSON.stringify({ email: EMAIL, loginKey: toBase64Url(newLoginKey()) }),
      { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
    );
    const rows = sqlite.prepare('SELECT email FROM login_failures').all() as { email: string }[];
    expect(rows.map((row) => row.email).join()).not.toContain('203.0.113.9');
    sqlite.prepare('UPDATE login_failures SET window_start = 0').run();
    await login(newLoginKey(), 'other@example.com');
    const left = sqlite.prepare('SELECT email FROM login_failures').all() as { email: string }[];
    expect(left.every((row) => row.email.startsWith('other@example.com'))).toBe(true);
  });

  it('opens a new window once the old one has passed', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await login(newLoginKey());
    sqlite.prepare('UPDATE login_failures SET window_start = 0').run();
    expect((await login(keys[0])).status).toBe(200);
  });

  it('clears failures after a successful login', async () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) await login(newLoginKey());
    expect((await login(keys[0])).status).toBe(200);
    expect(sqlite.prepare('SELECT * FROM login_failures').all()).toEqual([]);
  });

  it('logs in in four database round trips, and refuses a wrong key in two', async () => {
    let before = trips.count;
    expect((await login(keys[0])).status).toBe(200);
    expect(trips.count - before).toBe(4);
    before = trips.count;
    expect((await login(newLoginKey())).status).toBe(401);
    expect(trips.count - before).toBe(2);
  });
});

describe('sessions', () => {
  it('logout ends the session', async () => {
    await signUp();
    const cookie = client.cookie;
    expect((await client.request('POST', '/auth/logout', {})).status).toBe(204);
    expect(client.cookie).toBeNull();
    client.cookie = cookie;
    expect((await client.request('GET', '/account')).status).toBe(401);
  });

  it('forgets expired sessions when a new one starts', async () => {
    await signUp();
    sqlite.prepare('UPDATE sessions SET expires_at = 0').run();
    await new Client(env).request('POST', '/auth/login', {
      email: EMAIL,
      loginKey: toBase64Url(keys[0]),
    });
    expect(sqlite.prepare('SELECT * FROM sessions').all()).toHaveLength(1);
  });

  it('rejects a missing, forged or expired session', async () => {
    expect((await client.request('GET', '/account')).status).toBe(401);
    client.cookie = '__Host-arcafold_session=forged';
    expect((await client.request('GET', '/account')).status).toBe(401);
    await signUp();
    sqlite.prepare('UPDATE sessions SET expires_at = 0').run();
    expect((await client.request('GET', '/account')).status).toBe(401);
  });

  it('uses a plain cookie over http for local development', async () => {
    const local = new Client(env, 'http://localhost:8787');
    const res = await signUp(local);
    expect(res.headers.get('set-cookie')).toMatch(
      /^arcafold_session=[\w-]{43};.*HttpOnly; SameSite=Strict$/,
    );
    expect((await local.request('GET', '/account')).status).toBe(200);
  });
});
