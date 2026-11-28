import { randomBytes, toBase64Url } from '@arcafold/crypto/webcrypto';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import { KEY_SIZES, SPACE_HEADER, SPACE_MOVED_ERROR } from '@arcafold/types';
import type { AccountResponse, Keyring, PhotoPage } from '@arcafold/types';

import type { Env } from './env';
import { SPACE_TABLES, spaceTag } from './space-move';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';
import { createTestR2 } from './test/r2';

let env: Env;
let sqlite: DatabaseSync;
let owner: Client;
let loginKeys: [Uint8Array, Uint8Array, Uint8Array];
let keyring: Keyring;
let oldToken: string;
let currentVersion: number;

const random = (bytes: number) => toBase64Url(randomBytes(bytes));
const newId = () => random(16);
const newMeta = () => random(300);

function useSpace(c: Client, token: string): void {
  c.headers = { [SPACE_HEADER]: token };
}

async function signUp(email: string): Promise<Client> {
  const client = new Client(env);
  const other = await makeKeyring([newLoginKey(), newLoginKey(), newLoginKey()]);
  await client.request('POST', '/auth/signup', { email, name: 'Someone', keyring: other });
  return client;
}

beforeEach(async () => {
  const db = createTestDb();
  sqlite = db.sqlite;
  env = { DB: db.db, BLOBS: createTestR2().bucket };
  owner = new Client(env);
  loginKeys = [newLoginKey(), newLoginKey(), newLoginKey()];
  keyring = await makeKeyring(loginKeys);
  await owner.request('POST', '/auth/signup', { email: 'sam@example.com', name: 'Sam', keyring });
  const account = await owner.request('GET', '/account');
  currentVersion = (await account.json<AccountResponse>()).version;
  oldToken = newId();
  useSpace(owner, oldToken);
});

function putFile(c: Client, id: string, part: 'thumb' | 'full', data: Uint8Array) {
  return c.send('PUT', `/space/photos/${id}/${part}`, new Uint8Array(data), {
    'content-type': 'application/octet-stream',
    'content-length': String(data.length),
  });
}

/** Uploads a photo through `c`'s token and returns its id and original. */
async function upload(c: Client): Promise<{ id: string; full: Uint8Array }> {
  const thumb = randomBytes(100);
  const full = randomBytes(1000);
  const id = newId();
  const photo = { id, meta: newMeta(), thumbSize: thumb.length, fullSize: full.length };
  expect((await c.request('POST', '/space/photos', photo)).status).toBe(201);
  expect((await putFile(c, id, 'thumb', thumb)).status).toBe(200);
  expect((await putFile(c, id, 'full', full)).status).toBe(200);
  return { id, full };
}

async function photoIds(c: Client, token: string): Promise<string[]> {
  useSpace(c, token);
  const res = await c.request('GET', '/space/photos');
  expect(res.status).toBe(200);
  return (await res.json<PhotoPage>()).photos.map((photo) => photo.id).sort();
}

/** The answer to a request through a token that a moved library left behind. */
async function expectMoved(res: Response): Promise<void> {
  expect(res.status).toBe(410);
  expect((await res.json<{ code?: string }>()).code).toBe(SPACE_MOVED_ERROR);
}

/** How many rows every table keeps under a token's tag. */
async function rowsUnder(token: string): Promise<number> {
  const tag = await spaceTag(token);
  return SPACE_TABLES.reduce((total, table) => {
    const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE space = ?`).get(tag);
    return total + Number(row?.n ?? 0);
  }, 0);
}

/** A keyring change like the app's: new slot bytes, the same salt, KDF and verifiers. */
function changeKeyring(
  move: { from: string; to: string } | undefined,
  options: { version?: number; loginKey?: Uint8Array } = {},
): Promise<Response> {
  const next: Keyring = {
    ...keyring,
    slots: [random(KEY_SIZES.slot), random(KEY_SIZES.slot), keyring.slots[2]],
  };
  return owner.request('PUT', '/account/keyring', {
    loginKey: toBase64Url(options.loginKey ?? loginKeys[0]),
    version: options.version ?? currentVersion,
    keyring: next,
    ...(move ? { move } : {}),
  });
}

/** A library with a bit of everything: photos, an album, a member, a joined library and a phone. */
async function fillLibrary(): Promise<{
  photos: string[];
  memberToken: string;
  uploadToken: string;
}> {
  const photos = [(await upload(owner)).id, (await upload(owner)).id].sort();
  const albumId = newId();
  expect(
    (await owner.request('POST', '/space/albums', { id: albumId, meta: newMeta() })).status,
  ).toBe(201);
  const memberToken = newId();
  const member = { id: newId(), token: memberToken, meta: newMeta(), access: 'edit' };
  expect((await owner.request('POST', '/space/members', member)).status).toBe(201);
  expect(
    (await owner.request('POST', '/space/joined', { id: newId(), meta: newMeta() })).status,
  ).toBe(201);
  const uploadToken = newId();
  const phone = { id: newId(), token: uploadToken };
  expect((await owner.request('POST', '/space/upload-tokens', phone)).status).toBe(201);
  return { photos, memberToken, uploadToken };
}

describe('moving the main library with a keyring change', () => {
  it('takes every row to the new token, and refuses the old one', async () => {
    const { photos } = await fillLibrary();
    const before = await rowsUnder(oldToken);
    const newToken = newId();
    expect((await changeKeyring({ from: oldToken, to: newToken })).status).toBe(200);

    expect(await rowsUnder(oldToken)).toBe(0);
    expect(await rowsUnder(newToken)).toBe(before);
    expect(await photoIds(owner, newToken)).toEqual(photos);
    useSpace(owner, oldToken);
    await expectMoved(await owner.request('GET', '/space/photos'));
    await expectMoved(await owner.request('GET', '/space/albums'));
  });

  it('cuts off someone who kept the old token, whichever account they use', async () => {
    await fillLibrary();
    const stranger = await signUp('kim@example.com');
    expect(await photoIds(stranger, oldToken)).toHaveLength(2);
    expect((await changeKeyring({ from: oldToken, to: newId() })).status).toBe(200);
    useSpace(stranger, oldToken);
    await expectMoved(await stranger.request('GET', '/space/photos'));
    await expectMoved(await stranger.request('GET', '/space/members'));
  });

  it('adds nothing under the old token, so a tab left open with old keys loses no photos', async () => {
    await fillLibrary();
    expect((await changeKeyring({ from: oldToken, to: newId() })).status).toBe(200);
    useSpace(owner, oldToken);
    const photo = { id: newId(), meta: newMeta(), thumbSize: 100, fullSize: 1000 };
    await expectMoved(await owner.request('POST', '/space/photos', photo));
    await expectMoved(
      await owner.request('POST', '/space/albums', { id: newId(), meta: newMeta() }),
    );
    await expectMoved(await owner.request('DELETE', '/space', {}));
    expect(await rowsUnder(oldToken)).toBe(0);
  });

  it('never moves back to a token it moved away from', async () => {
    await fillLibrary();
    const newToken = newId();
    expect((await changeKeyring({ from: oldToken, to: newToken })).status).toBe(200);
    const account = await owner.request('GET', '/account');
    currentVersion = (await account.json<AccountResponse>()).version;
    expect((await changeKeyring({ from: newToken, to: oldToken })).status).toBe(409);
    expect(await rowsUnder(oldToken)).toBe(0);
  });

  it('never refuses a share or phone token, even one somebody named as a move', async () => {
    const { photos, memberToken, uploadToken } = await fillLibrary();
    // Another account names the tokens as the space its own keyring change moves away from.
    const loginKey = newLoginKey();
    const theirs = await makeKeyring([loginKey, newLoginKey(), newLoginKey()]);
    const someone = new Client(env);
    await someone.request('POST', '/auth/signup', {
      email: 'lee@example.com',
      name: 'Lee',
      keyring: theirs,
    });
    for (const token of [memberToken, uploadToken]) {
      const account = await (await someone.request('GET', '/account')).json<AccountResponse>();
      const res = await someone.request('PUT', '/account/keyring', {
        loginKey: toBase64Url(loginKey),
        version: account.version,
        keyring: theirs,
        move: { from: token, to: newId() },
      });
      expect(res.status).toBe(200);
    }
    const guest = await signUp('kim@example.com');
    expect(await photoIds(guest, memberToken)).toEqual(photos);
    useSpace(guest, uploadToken);
    await upload(guest);
  });

  it('keeps the files where they are, and members and phones keep working', async () => {
    const { photos, memberToken, uploadToken } = await fillLibrary();
    const newToken = newId();
    expect((await changeKeyring({ from: oldToken, to: newToken })).status).toBe(200);

    useSpace(owner, newToken);
    const original = await owner.request('GET', `/space/photos/${photos[0] ?? ''}/full`);
    expect(original.status).toBe(200);

    const guest = await signUp('kim@example.com');
    expect(await photoIds(guest, memberToken)).toEqual(photos);

    const phone = await signUp('lee@example.com');
    useSpace(phone, uploadToken);
    const added = await upload(phone);
    expect(await photoIds(owner, newToken)).toContain(added.id);
    expect(await rowsUnder(oldToken)).toBe(0);
  });

  it('signs out the other devices in the same step', async () => {
    const other = new Client(env);
    await other.request('POST', '/auth/login', {
      email: 'sam@example.com',
      loginKey: toBase64Url(loginKeys[0]),
    });
    expect((await other.request('GET', '/account')).status).toBe(200);
    expect((await changeKeyring({ from: oldToken, to: newId() })).status).toBe(200);
    expect((await other.request('GET', '/account')).status).toBe(401);
    expect((await owner.request('GET', '/account')).status).toBe(200);
  });

  it('moves nothing when the keyring change is refused', async () => {
    const { photos } = await fillLibrary();
    const before = await rowsUnder(oldToken);
    const newToken = newId();
    const stale = await changeKeyring(
      { from: oldToken, to: newToken },
      { version: currentVersion + 1 },
    );
    expect(stale.status).toBe(409);
    const wrong = await changeKeyring(
      { from: oldToken, to: newToken },
      { loginKey: newLoginKey() },
    );
    expect(wrong.status).toBe(403);

    expect(await rowsUnder(oldToken)).toBe(before);
    expect(await rowsUnder(newToken)).toBe(0);
    expect(await photoIds(owner, oldToken)).toEqual(photos);
    const account = await owner.request('GET', '/account');
    expect((await account.json<AccountResponse>()).keyring).toEqual(keyring);
  });

  it('refuses a token already in use, and changes nothing', async () => {
    const { memberToken, uploadToken } = await fillLibrary();
    const otherToken = newId();
    const someoneElse = await signUp('kim@example.com');
    useSpace(someoneElse, otherToken);
    await upload(someoneElse);
    const before = await rowsUnder(oldToken);

    for (const taken of [otherToken, memberToken, uploadToken]) {
      expect((await changeKeyring({ from: oldToken, to: taken })).status).toBe(409);
    }
    expect(await rowsUnder(oldToken)).toBe(before);
    expect(await photoIds(someoneElse, otherToken)).toHaveLength(1);
    const account = await owner.request('GET', '/account');
    expect((await account.json<AccountResponse>()).version).toBe(currentVersion);
  });

  it('refuses to move a space onto itself', async () => {
    expect((await changeKeyring({ from: oldToken, to: oldToken })).status).toBe(400);
  });

  it('refuses a token that isn’t one', async () => {
    for (const move of [
      { from: oldToken, to: 'short' },
      { from: random(17), to: newId() },
    ]) {
      expect((await changeKeyring(move)).status).toBe(400);
    }
  });

  it('moves nothing for a change that names two fresh tokens, as when the library stays put', async () => {
    const { photos } = await fillLibrary();
    const before = await rowsUnder(oldToken);
    const res = await changeKeyring({ from: newId(), to: newId() });
    expect(res.status).toBe(200);
    expect(await photoIds(owner, oldToken)).toEqual(photos);
    expect(await rowsUnder(oldToken)).toBe(before);
  });

  it('still takes a change without a move, from an app that sends none', async () => {
    const { photos } = await fillLibrary();
    expect((await changeKeyring(undefined)).status).toBe(200);
    expect(await photoIds(owner, oldToken)).toEqual(photos);
  });
});

describe('SPACE_TABLES', () => {
  it('names every table that keeps rows under a space, so a move leaves nothing behind', () => {
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => String(row.name));
    const withSpace = tables.filter((table) =>
      sqlite
        .prepare(`SELECT name FROM pragma_table_info(?)`)
        .all(table)
        .some((column) => column.name === 'space'),
    );
    expect([...SPACE_TABLES].sort()).toEqual(withSpace.sort());
  });
});
