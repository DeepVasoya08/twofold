import { toBase64Url } from '@arcafold/crypto/webcrypto';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DeviceList, Keyring } from '@arcafold/types';

import { ACTIVE_STEP_MS } from './db';
import type { Env } from './env';
import { createTestCounters } from './test/counters';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';

const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const EMAIL = 'sam@example.com';

let env: Env;
let sqlite: DatabaseSync;
let laptop: Client;
let phone: Client;
let keys: [Uint8Array, Uint8Array, Uint8Array];
let keyring: Keyring;

function clientOn(userAgent: string): Client {
  const client = new Client(env);
  client.headers['user-agent'] = userAgent;
  return client;
}

async function logIn(client: Client, slot = 0) {
  const key = keys[slot];
  if (!key) throw new Error('no such slot');
  const res = await client.request('POST', '/auth/login', {
    email: EMAIL,
    loginKey: toBase64Url(key),
  });
  expect(res.status).toBe(200);
}

async function devices(client: Client): Promise<DeviceList['devices']> {
  const res = await client.request('GET', '/account/devices');
  expect(res.status).toBe(200);
  return (await res.json<DeviceList>()).devices;
}

beforeEach(async () => {
  const test = createTestDb();
  sqlite = test.sqlite;
  env = { DB: test.db, BLOBS: {} as R2Bucket, COUNTERS: createTestCounters().namespace };
  keys = [newLoginKey(), newLoginKey(), newLoginKey()];
  keyring = await makeKeyring(keys);
  laptop = clientOn(MAC_CHROME);
  await laptop.request('POST', '/auth/signup', { email: EMAIL, name: 'Sam', keyring });
  phone = clientOn(IPHONE_SAFARI);
  await logIn(phone);
});

describe('GET /api/account/devices', () => {
  it('lists every signed-in device, this one first', async () => {
    const list = await devices(phone);
    expect(list.map(({ name, kind, current }) => ({ name, kind, current }))).toEqual([
      { name: 'Safari on iPhone', kind: 'phone', current: true },
      { name: 'Chrome on macOS', kind: 'computer', current: false },
    ]);
    for (const device of list) {
      expect(device.id).toMatch(/^[0-9a-f]{32}$/);
      expect(device.lastActive % ACTIVE_STEP_MS).toBe(0);
      expect(device.signedInAt).toBeGreaterThanOrEqual(device.lastActive);
    }
    expect((await devices(laptop))[0]?.name).toBe('Chrome on macOS');
  });

  it("doesn't show other accounts' devices", async () => {
    const other = clientOn(MAC_CHROME);
    const otherKeyring = await makeKeyring([newLoginKey(), newLoginKey(), newLoginKey()]);
    await other.request('POST', '/auth/signup', {
      email: 'alex@example.com',
      name: 'Alex',
      keyring: otherKeyring,
    });
    expect(await devices(other)).toHaveLength(1);
  });

  it('stores nothing that tells which password opened a session', async () => {
    const privatePhone = clientOn(IPHONE_SAFARI);
    await logIn(privatePhone, 2);
    const rows = sqlite
      .prepare('SELECT * FROM sessions WHERE device = ? ORDER BY created_at')
      .all('Safari on iPhone') as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0] ?? {})).toEqual(Object.keys(rows[1] ?? {}));
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
      [
        'account_id',
        'created_at',
        'device',
        'device_kind',
        'expires_at',
        'id',
        'last_active',
        'token_hash',
      ].sort(),
    );
  });

  it('marks a device used at most once an hour, and labels sessions that had no label', async () => {
    sqlite.prepare("UPDATE sessions SET device = '', last_active = 0").run();
    await devices(phone);
    const rows = sqlite.prepare('SELECT device, last_active FROM sessions').all() as {
      device: string;
      last_active: number;
    }[];
    const touched = rows.find((row) => row.device === 'Safari on iPhone');
    expect(touched?.last_active).toBeGreaterThan(0);
    expect(rows.find((row) => row.device === '')?.last_active).toBe(0);
  });

  it('needs a session', async () => {
    const res = await new Client(env).request('GET', '/account/devices');
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/account/devices/:id', () => {
  it('signs out another device', async () => {
    const target = (await devices(laptop)).find((device) => !device.current);
    const res = await laptop.request('DELETE', `/account/devices/${target?.id ?? ''}`, {});
    expect(res.status).toBe(204);
    expect((await phone.request('GET', '/account')).status).toBe(401);
    expect(await devices(laptop)).toHaveLength(1);
  });

  it("can't sign out the device asking (that's /auth/logout)", async () => {
    const own = (await devices(laptop)).find((device) => device.current);
    const res = await laptop.request('DELETE', `/account/devices/${own?.id ?? ''}`, {});
    expect(res.status).toBe(404);
    expect((await laptop.request('GET', '/account')).status).toBe(200);
  });

  it("can't sign out another account's device", async () => {
    const target = (await devices(phone)).find((device) => device.current);
    const other = clientOn(MAC_CHROME);
    await other.request('POST', '/auth/signup', {
      email: 'alex@example.com',
      name: 'Alex',
      keyring: await makeKeyring([newLoginKey(), newLoginKey(), newLoginKey()]),
    });
    const res = await other.request('DELETE', `/account/devices/${target?.id ?? ''}`, {});
    expect(res.status).toBe(404);
    expect((await phone.request('GET', '/account')).status).toBe(200);
  });

  it('refuses a malformed id', async () => {
    const res = await laptop.request('DELETE', '/account/devices/not-an-id', {});
    expect(res.status).toBe(400);
  });

  it('needs a session', async () => {
    const res = await new Client(env).request('DELETE', `/account/devices/${'a'.repeat(32)}`, {});
    expect(res.status).toBe(401);
  });
});
