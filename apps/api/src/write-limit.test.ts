import { randomBytes, toBase64Url } from '@arcafold/crypto/webcrypto';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PLAN_STORAGE, SPACE_HEADER } from '@arcafold/types';

import type { Env } from './env';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';
import { createTestR2 } from './test/r2';
import {
  FREE_DAILY_WRITE_BYTES,
  MIN_WRITE_BYTES,
  PLAN_WRITE_SHARE,
  spendWrite,
} from './write-limit';

let env: Env;
let sqlite: DatabaseSync;

const newId = () => toBase64Url(randomBytes(16));
const newMeta = () => toBase64Url(randomBytes(300));

beforeEach(() => {
  const db = createTestDb();
  sqlite = db.sqlite;
  env = { DB: db.db, BLOBS: createTestR2().bucket };
});

async function signedIn(email: string): Promise<Client> {
  const client = new Client(env);
  const keyring = await makeKeyring([newLoginKey(), newLoginKey(), newLoginKey()]);
  await client.request('POST', '/auth/signup', { email, name: 'Sam', keyring });
  client.headers = { [SPACE_HEADER]: toBase64Url(randomBytes(16)) };
  return client;
}

const accountId = (email: string) =>
  (sqlite.prepare('SELECT id FROM accounts WHERE email = ?').get(email) as { id: string }).id;
const budgets = () =>
  sqlite.prepare('SELECT key, window_start, bytes FROM write_budgets').all() as {
    key: string;
    window_start: number;
    bytes: number;
  }[];
const spentToday = () => budgets().reduce((total, row) => total + row.bytes, 0);
const newAlbum = (c: Client) =>
  c.request('POST', '/space/albums', { id: newId(), meta: newMeta() });

describe('the daily limit on what an account adds to the database', () => {
  it('counts each write before it runs, by its size', async () => {
    const sam = await signedIn('sam@example.com');
    const body = JSON.stringify({ id: newId(), meta: newMeta() });
    const res = await sam.send('POST', '/space/albums', body, {
      'content-type': 'application/json',
    });
    expect(res.status).toBe(201);
    expect(spentToday()).toBe(Math.max(body.length, MIN_WRITE_BYTES));
    // Reading adds nothing.
    await sam.request('GET', '/space/albums');
    expect(spentToday()).toBe(Math.max(body.length, MIN_WRITE_BYTES));
  });

  it('refuses writes once the day’s limit is reached, and only for that account', async () => {
    const sam = await signedIn('sam@example.com');
    const alex = await signedIn('alex@example.com');
    expect((await newAlbum(sam)).status).toBe(201);
    sqlite.prepare('UPDATE write_budgets SET bytes = ?').run(FREE_DAILY_WRITE_BYTES - 10);
    const refused = await newAlbum(sam);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({
      error: 'You’ve made a lot of changes today. Try again tomorrow.',
    });
    expect((await sam.request('GET', '/space/albums')).status).toBe(200);
    expect((await newAlbum(alex)).status).toBe(201);
  });

  it('counts invites too', async () => {
    const sam = await signedIn('sam@example.com');
    await sam.request('POST', '/invites', {});
    expect(spentToday()).toBeGreaterThanOrEqual(MIN_WRITE_BYTES);
  });

  it('leaves file uploads to the storage limit', async () => {
    const sam = await signedIn('sam@example.com');
    const photo = { id: newId(), meta: newMeta(), thumbSize: 10, fullSize: 20 };
    expect((await sam.request('POST', '/space/photos', photo)).status).toBe(201);
    const before = spentToday();
    const res = await sam.send('PUT', `/space/photos/${photo.id}/thumb`, randomBytes(10), {
      'content-type': 'application/octet-stream',
      'content-length': '10',
    });
    expect(res.status).toBe(200);
    expect(spentToday()).toBe(before);
  });

  it('starts a new day once the old one has passed', async () => {
    const sam = await signedIn('sam@example.com');
    await newAlbum(sam);
    sqlite
      .prepare('UPDATE write_budgets SET bytes = ?, window_start = 0')
      .run(FREE_DAILY_WRITE_BYTES);
    expect((await newAlbum(sam)).status).toBe(201);
    expect(spentToday()).toBeLessThan(FREE_DAILY_WRITE_BYTES);
  });

  it('gives a paid plan a share of its storage a day instead', async () => {
    const sam = await signedIn('sam@example.com');
    await newAlbum(sam);
    sqlite
      .prepare(
        `INSERT INTO billing (account_id, plan, storage_bytes, paid_until, updated_at)
         VALUES (?, 'plus', ?, ?, 0)`,
      )
      .run(accountId('sam@example.com'), PLAN_STORAGE.plus, Date.now() + 86_400_000);
    sqlite.prepare('UPDATE write_budgets SET bytes = ?').run(FREE_DAILY_WRITE_BYTES);
    expect((await newAlbum(sam)).status).toBe(201);
    sqlite.prepare('UPDATE write_budgets SET bytes = ?').run(PLAN_STORAGE.plus / PLAN_WRITE_SHARE);
    expect((await newAlbum(sam)).status).toBe(429);
  });

  it('keeps no account id in readable form when the Worker has its secret', async () => {
    env.EMAIL_CODE_SECRET = 'x'.repeat(40);
    const sam = await signedIn('sam@example.com');
    await newAlbum(sam);
    const [row] = budgets();
    expect(row?.key).toBeDefined();
    expect(row?.key).not.toContain(accountId('sam@example.com'));
  });

  it('can’t be raced: parallel writes stop at the limit', async () => {
    const sam = await signedIn('sam@example.com');
    await newAlbum(sam);
    sqlite.prepare('UPDATE write_budgets SET bytes = ?').run(FREE_DAILY_WRITE_BYTES - 3000);
    const results = await Promise.all(Array.from({ length: 10 }, () => newAlbum(sam)));
    const allowed = results.filter((res) => res.status === 201).length;
    expect(allowed).toBeGreaterThan(0);
    expect(allowed).toBeLessThan(10);
    expect(spentToday()).toBeGreaterThan(FREE_DAILY_WRITE_BYTES);
  });

  it('logs when the database is getting full, with its size only', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sam = await signedIn('sam@example.com');
    await newAlbum(sam);
    const id = accountId('sam@example.com');
    expect(await spendWrite(env.DB, 'key', id, 600, Date.now(), Number.MAX_SAFE_INTEGER)).toBe(
      true,
    );
    expect(error).not.toHaveBeenCalled();
    expect(await spendWrite(env.DB, 'key', id, 600, Date.now(), 1)).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toMatch(/^The database is \d+ MB/);
    error.mockRestore();
  });
});
