import { toBase64Url } from '@twofold/crypto/webcrypto';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AccountResponse, Keyring } from '@twofold/types';

import type { Env } from './env';
import { MAX_FAILURES } from './proof';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';

let env: Env;
let sqlite: DatabaseSync;
let client: Client;
let keys: [Uint8Array, Uint8Array, Uint8Array];
let keyring: Keyring;

const EMAIL = 'someone@example.com';

beforeEach(async () => {
  const test = createTestDb();
  sqlite = test.sqlite;
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
    expect(body).toEqual({ email: EMAIL, name: 'Sam', version: 1, keyring });
    expect(res.headers.get('set-cookie')).toMatch(
      /^__Host-twofold_session=[\w-]{43}; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Strict$/,
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
      'https://twofold.test/api/auth/signup',
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
    expect(await res.json()).toEqual({ email: EMAIL, name: 'Sam', version: 1, keyring });
    expect(client.cookie).toMatch(/^__Host-twofold_session=/);
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

  it('rejects a missing, forged or expired session', async () => {
    expect((await client.request('GET', '/account')).status).toBe(401);
    client.cookie = '__Host-twofold_session=forged';
    expect((await client.request('GET', '/account')).status).toBe(401);
    await signUp();
    sqlite.prepare('UPDATE sessions SET expires_at = 0').run();
    expect((await client.request('GET', '/account')).status).toBe(401);
  });

  it('uses a plain cookie over http for local development', async () => {
    const local = new Client(env, 'http://localhost:8787');
    const res = await signUp(local);
    expect(res.headers.get('set-cookie')).toMatch(
      /^twofold_session=[\w-]{43};.*HttpOnly; SameSite=Strict$/,
    );
    expect((await local.request('GET', '/account')).status).toBe(200);
  });
});
