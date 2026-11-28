import { randomBytes, toBase64Url } from '@arcafold/crypto/webcrypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { KEY_SIZES, SMART_FEATURES_VERSION } from '@arcafold/types';
import type { AccountResponse, Keyring } from '@arcafold/types';

import type { Env } from './env';
import { createTestCounters } from './test/counters';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';

let env: Env;
let client: Client;
let keys: [Uint8Array, Uint8Array, Uint8Array];
let keyring: Keyring;

beforeEach(async () => {
  env = { DB: createTestDb().db, BLOBS: {} as R2Bucket, COUNTERS: createTestCounters().namespace };
  client = new Client(env);
  keys = [newLoginKey(), newLoginKey(), newLoginKey()];
  keyring = await makeKeyring(keys);
  await client.request('POST', '/auth/signup', { email: 'sam@example.com', name: 'Sam', keyring });
});

function withNewPrivateSlot(base: Keyring, loginKeyVerifier: string): Keyring {
  return {
    ...base,
    slots: [base.slots[0], base.slots[1], toBase64Url(randomBytes(KEY_SIZES.slot))],
    verifiers: [base.verifiers[0], base.verifiers[1], loginKeyVerifier],
  };
}

describe('GET /api/account', () => {
  it('returns the account and keyring', async () => {
    const res = await client.request('GET', '/account');
    expect(await res.json()).toEqual({
      email: 'sam@example.com',
      name: 'Sam',
      version: 1,
      keyring,
      smartFeatures: null,
      emailVerified: false,
      mustVerifyEmail: false,
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('PUT /api/account/smart-features', () => {
  it('keeps the answer, and a later answer replaces it', async () => {
    const res = await client.request('PUT', '/account/smart-features', {
      choice: 'on',
      version: SMART_FEATURES_VERSION,
    });
    expect(res.status).toBe(200);
    expect((await res.json<AccountResponse>()).smartFeatures).toEqual({
      choice: 'on',
      version: SMART_FEATURES_VERSION,
    });
    await client.request('PUT', '/account/smart-features', {
      choice: 'off',
      version: SMART_FEATURES_VERSION,
    });
    const reread = await client.request('GET', '/account');
    expect((await reread.json<AccountResponse>()).smartFeatures).toEqual({
      choice: 'off',
      version: SMART_FEATURES_VERSION,
    });
  });

  it('keeps only the day it was answered', async () => {
    await client.request('PUT', '/account/smart-features', {
      choice: 'on',
      version: SMART_FEATURES_VERSION,
    });
    const row = await env.DB.prepare('SELECT smart_at FROM accounts WHERE email = ?')
      .bind('sam@example.com')
      .first<{ smart_at: number }>();
    expect(row?.smart_at).toBeTypeOf('number');
    expect((row?.smart_at ?? 1) % (24 * 60 * 60 * 1000)).toBe(0);
  });

  it('refuses an unknown choice or another version, and changes nothing', async () => {
    for (const body of [
      { choice: 'maybe', version: SMART_FEATURES_VERSION },
      { choice: 'on', version: SMART_FEATURES_VERSION + 1 },
      { choice: 'on', version: 0 },
      { choice: 'on' },
      { choice: 'on', version: SMART_FEATURES_VERSION, extra: true },
    ]) {
      expect((await client.request('PUT', '/account/smart-features', body)).status).toBe(400);
    }
    const reread = await client.request('GET', '/account');
    expect((await reread.json<AccountResponse>()).smartFeatures).toBeNull();
  });

  it('needs a session', async () => {
    const res = await new Client(env).request('PUT', '/account/smart-features', {
      choice: 'on',
      version: SMART_FEATURES_VERSION,
    });
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/account/name', () => {
  it('renames the account', async () => {
    const res = await client.request('PUT', '/account/name', { name: '  Sam Rivera ' });
    expect(res.status).toBe(200);
    expect((await res.json<AccountResponse>()).name).toBe('Sam Rivera');
    const reread = await client.request('GET', '/account');
    expect((await reread.json<AccountResponse>()).name).toBe('Sam Rivera');
  });

  it('refuses an empty or overlong name, and changes nothing', async () => {
    for (const name of ['', '   ', 'x'.repeat(61)]) {
      expect((await client.request('PUT', '/account/name', { name })).status).toBe(400);
    }
    expect((await client.request('PUT', '/account/name', { name: 'A', extra: 1 })).status).toBe(
      400,
    );
    const reread = await client.request('GET', '/account');
    expect((await reread.json<AccountResponse>()).name).toBe('Sam');
  });

  it('needs a session', async () => {
    const res = await new Client(env).request('PUT', '/account/name', { name: 'Kim' });
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/account/keyring', () => {
  it('replaces the keyring and bumps the version', async () => {
    const next = withNewPrivateSlot(keyring, toBase64Url(randomBytes(32)));
    const res = await client.request('PUT', '/account/keyring', {
      loginKey: toBase64Url(keys[0]),
      version: 1,
      keyring: next,
    });
    expect(res.status).toBe(200);
    const body = await res.json<AccountResponse>();
    expect(body.version).toBe(2);
    expect(body.keyring).toEqual(next);
    const reread = await client.request('GET', '/account');
    expect((await reread.json<AccountResponse>()).keyring).toEqual(next);
  });

  it('accepts a proof from any slot', async () => {
    const res = await client.request('PUT', '/account/keyring', {
      loginKey: toBase64Url(keys[2]),
      version: 1,
      keyring,
    });
    expect(res.status).toBe(200);
  });

  it('needs a login key, not just the session', async () => {
    const res = await client.request('PUT', '/account/keyring', {
      loginKey: toBase64Url(newLoginKey()),
      version: 1,
      keyring,
    });
    expect(res.status).toBe(403);
  });

  it('refuses a stale version', async () => {
    const put = (version: number) =>
      client.request('PUT', '/account/keyring', {
        loginKey: toBase64Url(keys[0]),
        version,
        keyring,
      });
    expect((await put(1)).status).toBe(200);
    expect((await put(1)).status).toBe(409);
  });

  it('refuses a changed salt or KDF', async () => {
    for (const next of [
      { ...keyring, salt: toBase64Url(randomBytes(KEY_SIZES.salt)) },
      { ...keyring, kdf: { opsLimit: 4, memLimit: keyring.kdf.memLimit } },
    ]) {
      const res = await client.request('PUT', '/account/keyring', {
        loginKey: toBase64Url(keys[0]),
        version: 1,
        keyring: next,
      });
      expect(res.status).toBe(400);
    }
  });

  it('signs out every other device, but not this one', async () => {
    const other = new Client(env);
    await other.request('POST', '/auth/login', {
      email: 'sam@example.com',
      loginKey: toBase64Url(keys[0]),
    });
    expect((await other.request('GET', '/account')).status).toBe(200);
    const res = await client.request('PUT', '/account/keyring', {
      loginKey: toBase64Url(keys[0]),
      version: 1,
      keyring,
    });
    expect(res.status).toBe(200);
    expect((await client.request('GET', '/account')).status).toBe(200);
    expect((await other.request('GET', '/account')).status).toBe(401);
  });

  it('keeps other devices signed in when the change is refused', async () => {
    const other = new Client(env);
    await other.request('POST', '/auth/login', {
      email: 'sam@example.com',
      loginKey: toBase64Url(keys[0]),
    });
    await client.request('PUT', '/account/keyring', {
      loginKey: toBase64Url(newLoginKey()),
      version: 1,
      keyring,
    });
    expect((await other.request('GET', '/account')).status).toBe(200);
  });

  it('needs a session', async () => {
    const res = await new Client(env).request('PUT', '/account/keyring', {
      loginKey: toBase64Url(keys[0]),
      version: 1,
      keyring,
    });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/account', () => {
  it('needs a login key', async () => {
    const res = await client.request('DELETE', '/account', {
      loginKey: toBase64Url(newLoginKey()),
    });
    expect(res.status).toBe(403);
    expect((await client.request('GET', '/account')).status).toBe(200);
  });

  it('deletes the account and every session', async () => {
    const other = new Client(env);
    await other.request('POST', '/auth/login', {
      email: 'sam@example.com',
      loginKey: toBase64Url(keys[0]),
    });
    const res = await client.request('DELETE', '/account', { loginKey: toBase64Url(keys[0]) });
    expect(res.status).toBe(204);
    expect((await other.request('GET', '/account')).status).toBe(401);
    const login = await other.request('POST', '/auth/login', {
      email: 'sam@example.com',
      loginKey: toBase64Url(keys[0]),
    });
    expect(login.status).toBe(401);
  });
});
