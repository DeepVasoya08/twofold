import { randomBytes, toBase64Url } from '@arcafold/crypto/webcrypto';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import { SPACE_HEADER } from '@arcafold/types';
import type { AccountStorage } from '@arcafold/types';

import { countersOf } from './account-counts';
import type { Env } from './env';
import { createTestCounters } from './test/counters';
import type { TestCounters } from './test/counters';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';
import { createTestR2 } from './test/r2';

let env: Env;
let counters: TestCounters;
let sqlite: DatabaseSync;

const DAY = 24 * 60 * 60 * 1000;
const newId = () => toBase64Url(randomBytes(16));
const newMeta = () => toBase64Url(randomBytes(300));
const wrongCode = () => `TWO-${'A'.repeat(4)}-${'B'.repeat(4)}`;

beforeEach(() => {
  const db = createTestDb();
  sqlite = db.sqlite;
  counters = createTestCounters();
  env = { DB: db.db, BLOBS: createTestR2().bucket, COUNTERS: counters.namespace };
});

async function signUp(email: string, loginKey = newLoginKey()): Promise<Client> {
  const client = new Client(env);
  const keyring = await makeKeyring([loginKey, newLoginKey(), newLoginKey()]);
  await client.request('POST', '/auth/signup', { email, name: 'Sam', keyring });
  return client;
}

const accountId = (email: string) =>
  (sqlite.prepare('SELECT id FROM accounts WHERE email = ?').get(email) as { id: string }).id;

function useSpace(c: Client, token: string): void {
  c.headers = { [SPACE_HEADER]: token };
}

/** Uploads a photo of a 100-byte preview and a `size`-byte file, and returns its id. */
async function upload(c: Client, size: number): Promise<string> {
  const id = newId();
  const files = { thumb: randomBytes(100), full: randomBytes(size) };
  const photo = { id, meta: newMeta(), thumbSize: 100, fullSize: size };
  expect((await c.request('POST', '/space/photos', photo)).status).toBe(201);
  for (const [part, data] of Object.entries(files)) {
    const res = await c.send('PUT', `/space/photos/${id}/${part}`, data, {
      'content-type': 'application/octet-stream',
      'content-length': String(data.length),
    });
    expect(res.status).toBe(200);
  }
  return id;
}

describe('an account’s counters', () => {
  const counts = () => countersOf(env, 'some account');

  it('add an upload only while it stays within the limit', async () => {
    expect(await counts().reserve(600, 1000)).toBe(true);
    expect(await counts().reserve(500, 1000)).toBe(false);
    expect(await counts().reserve(400, 1000)).toBe(true);
    expect(await counts().stored()).toBe(1000);
  });

  it('give bytes back, never below zero', async () => {
    await counts().add(300);
    await counts().release(100);
    expect(await counts().stored()).toBe(200);
    await counts().release(1000);
    expect(await counts().stored()).toBe(0);
  });

  it('can’t be raced: parallel uploads stop at the limit', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => counts().reserve(100, 950)));
    expect(results.filter(Boolean)).toHaveLength(9);
    expect(await counts().stored()).toBe(900);
  });

  it('keep each account apart', async () => {
    await countersOf(env, 'one').add(100);
    expect(await countersOf(env, 'two').stored()).toBe(0);
  });

  it('count within a window, and start a new one once it has passed', async () => {
    const start = 1_000_000;
    expect(await counts().count('writes', 10, start, DAY)).toBe(10);
    expect(await counts().count('writes', 5, start + DAY - 1, DAY)).toBe(15);
    // Other windows count apart.
    expect(await counts().count('invite tries', 1, start, DAY)).toBe(1);
    expect(await counts().count('writes', 7, start + DAY, DAY)).toBe(7);
    expect(counters.window('some account', 'writes')).toEqual({ start: start + DAY, total: 7 });
  });

  it('take back part of a count, never below zero', async () => {
    await counts().count('invite tries', 2, 1000, DAY);
    await counts().giveBack('invite tries', 1);
    expect(counters.window('some account', 'invite tries')?.total).toBe(1);
    await counts().giveBack('invite tries', 5);
    expect(counters.window('some account', 'invite tries')?.total).toBe(0);
    // Giving back with nothing counted does nothing.
    await counts().giveBack('writes', 1);
    expect(counters.window('some account', 'writes')).toBeUndefined();
  });

  it('refuse amounts that aren’t whole counts, and change nothing', async () => {
    await counts().add(100);
    for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      await expect(counts().add(bad)).rejects.toThrow(RangeError);
      await expect(counts().reserve(bad, 1000)).rejects.toThrow(RangeError);
      await expect(counts().reserve(1, bad)).rejects.toThrow(RangeError);
      await expect(counts().release(bad)).rejects.toThrow(RangeError);
      await expect(counts().count('writes', bad, 1000, DAY)).rejects.toThrow(RangeError);
    }
    expect(await counts().stored()).toBe(100);
    expect(counters.window('some account', 'writes')).toBeUndefined();
  });

  it('forget everything', async () => {
    await counts().add(100);
    await counts().count('writes', 10, 1000, DAY);
    await counts().forget();
    expect(counters.kept('some account')).toEqual(new Map());
  });
});

describe('account totals and counts', () => {
  it('move an old total out of the database once, however many requests see it', async () => {
    const sam = await signUp('sam@example.com');
    const id = accountId('sam@example.com');
    sqlite.prepare('UPDATE accounts SET stored_bytes = 5000 WHERE id = ?').run(id);
    counters.setStored(id, 200);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => sam.request('GET', '/account/storage')),
    );
    expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
    expect(counters.stored(id)).toBe(5200);
    expect(sqlite.prepare('SELECT stored_bytes FROM accounts').get()).toEqual({ stored_bytes: 0 });
    const res = await sam.request('GET', '/account/storage');
    expect((await res.json<AccountStorage>()).used).toBe(5200);
  });

  it('move an old total before giving bytes back', async () => {
    const sam = await signUp('sam@example.com');
    useSpace(sam, newId());
    const photo = { id: newId(), meta: newMeta(), image: toBase64Url(randomBytes(1000)) };
    expect((await sam.request('PUT', '/space/profile-photo', photo)).status).toBe(204);
    const id = accountId('sam@example.com');
    sqlite.prepare('UPDATE accounts SET stored_bytes = 5000 WHERE id = ?').run(id);
    expect((await sam.request('DELETE', '/space/profile-photo', {})).status).toBe(204);
    expect(counters.stored(id)).toBe(5000);
  });

  it('change nothing in the database outside the spaces’ own rows', async () => {
    const sam = await signUp('sam@example.com');
    const id = accountId('sam@example.com');
    // Every row of every table that isn't kept per space (but SQLite's own).
    const outsideSpaces = () => {
      const tables = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'sqlite_sequence'",
        )
        .all() as { name: string }[];
      return Object.fromEntries(
        tables
          .filter(({ name }) => {
            const columns = sqlite.prepare(`PRAGMA table_info("${name}")`).all();
            return !columns.some((column) => column.name === 'space');
          })
          .map(({ name }) => [name, sqlite.prepare(`SELECT * FROM "${name}"`).all()]),
      );
    };
    const before = outsideSpaces();
    expect(Object.keys(before)).toEqual(expect.arrayContaining(['accounts', 'sessions']));

    // One space uploads a photo, adds a profile photo and an album, and tries a wrong
    // invite code.
    useSpace(sam, newId());
    await upload(sam, 1000);
    const photo = { id: newId(), meta: newMeta(), image: toBase64Url(randomBytes(2000)) };
    expect((await sam.request('PUT', '/space/profile-photo', photo)).status).toBe(204);
    const album = { id: newId(), meta: newMeta() };
    expect((await sam.request('POST', '/space/albums', album)).status).toBe(201);
    expect((await sam.request('GET', `/invites/join/${wrongCode()}`)).status).toBe(404);
    // The other uploads a photo and deletes it, and adds a profile photo and removes it.
    useSpace(sam, newId());
    const deleted = await upload(sam, 3000);
    expect((await sam.request('DELETE', `/space/photos/${deleted}`, {})).status).toBe(204);
    const other = { id: newId(), meta: newMeta(), image: toBase64Url(randomBytes(500)) };
    expect((await sam.request('PUT', '/space/profile-photo', other)).status).toBe(204);
    expect((await sam.request('DELETE', '/space/profile-photo', {})).status).toBe(204);

    expect(outsideSpaces()).toEqual(before);
    // The counts moved all the same, outside the database.
    expect(counters.stored(id)).toBe(1100 + 2000);
    expect(counters.window(id, 'writes')?.total).toBeGreaterThan(0);
    expect(counters.window(id, 'invite tries')?.total).toBe(1);
  });

  it('go with the account when it is deleted', async () => {
    const loginKey = newLoginKey();
    const sam = await signUp('sam@example.com', loginKey);
    const id = accountId('sam@example.com');
    useSpace(sam, newId());
    const photo = { id: newId(), meta: newMeta(), image: toBase64Url(randomBytes(1000)) };
    expect((await sam.request('PUT', '/space/profile-photo', photo)).status).toBe(204);
    expect((await sam.request('GET', `/invites/join/${wrongCode()}`)).status).toBe(404);
    expect(counters.kept(id).size).toBeGreaterThan(0);
    const res = await sam.request('DELETE', '/account', { loginKey: toBase64Url(loginKey) });
    expect(res.status).toBe(204);
    expect(counters.kept(id)).toEqual(new Map());
  });
});
