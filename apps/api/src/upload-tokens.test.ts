import { randomBytes, toBase64Url } from '@arcafold/crypto/webcrypto';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import { SPACE_HEADER } from '@arcafold/types';
import type { PhotoPage, UploadKeyResponse, UploadTokenList } from '@arcafold/types';

import type { Env } from './env';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';
import { createTestR2 } from './test/r2';
import { MAX_UPLOAD_TOKENS } from './upload-db';

let env: Env;
let sqlite: DatabaseSync;
let owner: Client;
let phone: Client;
let spaceToken: string;
let uploadToken: string;
let uploadId: string;

const newId = () => toBase64Url(randomBytes(16));
const newMeta = () => toBase64Url(randomBytes(300));

function useSpace(c: Client, token: string): void {
  c.headers = { [SPACE_HEADER]: token };
}

function putFile(c: Client, id: string, part: 'thumb' | 'full', data: Uint8Array) {
  return c.send('PUT', `/space/photos/${id}/${part}`, new Uint8Array(data), {
    'content-type': 'application/octet-stream',
    'content-length': String(data.length),
  });
}

/** Uploads a photo with random contents through `c`; the second file commits it. */
async function upload(c: Client) {
  const thumb = randomBytes(100);
  const full = randomBytes(1000);
  const photo = { id: newId(), meta: newMeta(), thumbSize: thumb.length, fullSize: full.length };
  expect((await c.request('POST', '/space/photos', photo)).status).toBe(201);
  expect((await putFile(c, photo.id, 'thumb', thumb)).status).toBe(200);
  expect(await (await putFile(c, photo.id, 'full', full)).json()).toEqual({ committed: true });
  return photo;
}

async function listPhotos(c: Client): Promise<PhotoPage> {
  const res = await c.request('GET', '/space/photos');
  expect(res.status).toBe(200);
  return res.json<PhotoPage>();
}

beforeEach(async () => {
  const db = createTestDb();
  sqlite = db.sqlite;
  env = { DB: db.db, BLOBS: createTestR2().bucket };
  owner = new Client(env);
  const keyring = await makeKeyring([newLoginKey(), newLoginKey(), newLoginKey()]);
  await owner.request('POST', '/auth/signup', { email: 'sam@example.com', name: 'Sam', keyring });
  spaceToken = toBase64Url(randomBytes(16));
  useSpace(owner, spaceToken);
  uploadToken = toBase64Url(randomBytes(16));
  uploadId = newId();
  const res = await owner.request('POST', '/space/upload-tokens', {
    id: uploadId,
    token: uploadToken,
  });
  expect(res.status).toBe(201);
  // The phone backing up is the same account's session, with the upload-only token.
  phone = new Client(env);
  phone.cookie = owner.cookie;
  useSpace(phone, uploadToken);
});

describe('upload key', () => {
  it('is kept once, for the owner only', async () => {
    expect(
      await (await owner.request('GET', '/space/upload-key')).json<UploadKeyResponse>(),
    ).toEqual({ meta: null });
    const meta = newMeta();
    expect((await owner.request('PUT', '/space/upload-key', { meta })).status).toBe(204);
    // A second device setting one up keeps the first.
    expect((await owner.request('PUT', '/space/upload-key', { meta: newMeta() })).status).toBe(409);
    expect(
      await (await owner.request('GET', '/space/upload-key')).json<UploadKeyResponse>(),
    ).toEqual({ meta });
    expect((await phone.request('GET', '/space/upload-key')).status).toBe(403);
    expect((await phone.request('PUT', '/space/upload-key', { meta })).status).toBe(403);
  });
});

describe('upload-only tokens', () => {
  it('add photos sealed for the owner, which the owner sees flagged', async () => {
    const added = await upload(phone);
    const mine = await upload(owner);
    const { photos } = await listPhotos(owner);
    expect(photos.find((photo) => photo.id === added.id)?.sealedForOwner).toBe(true);
    expect(photos.find((photo) => photo.id === mine.id)?.sealedForOwner).toBeUndefined();
  });

  it('clears the flag once the owner seals the photo again', async () => {
    const added = await upload(phone);
    const meta = newMeta();
    expect((await owner.request('PUT', `/space/photos/${added.id}`, { meta })).status).toBe(204);
    const [photo] = (await listPhotos(owner)).photos;
    expect(photo).toEqual({ ...added, meta });
  });

  it('can commit, but not list, read, change or delete anything', async () => {
    const mine = await upload(owner);
    const added = await upload(phone);
    expect((await phone.request('POST', `/space/photos/${added.id}/commit`, {})).status).toBe(204);
    const refused = [
      ['GET', '/space/photos'],
      ['GET', `/space/photos/${mine.id}/thumb`],
      ['GET', `/space/photos/${added.id}/full`],
      ['GET', `/space/thumbs?ids=${mine.id}`],
      ['PUT', `/space/photos/${mine.id}`, { meta: newMeta() }],
      ['DELETE', `/space/photos/${mine.id}`, {}],
      ['POST', '/space/trash', { photos: [{ id: mine.id, meta: newMeta() }] }],
      ['GET', '/space/albums'],
      ['POST', '/space/albums', { id: newId(), meta: newMeta() }],
      ['GET', '/space/members'],
      ['GET', '/space/membership'],
      ['GET', '/space/upload-tokens'],
      ['POST', '/space/upload-tokens', { id: newId(), token: toBase64Url(randomBytes(16)) }],
      ['DELETE', `/space/upload-tokens/${uploadId}`, {}],
      ['DELETE', '/space', {}],
    ] as const;
    for (const [method, path, body] of refused) {
      const res = await phone.request(method, path, body);
      expect([method, path, res.status]).toEqual([method, path, 403]);
    }
    expect((await listPhotos(owner)).photos).toHaveLength(2);
  });

  it("can't overwrite a committed photo's files", async () => {
    const mine = await upload(owner);
    expect((await putFile(phone, mine.id, 'full', randomBytes(1000))).status).toBe(404);
  });

  it('stop working once revoked', async () => {
    expect(
      await (await owner.request('GET', '/space/upload-tokens')).json<UploadTokenList>(),
    ).toEqual({ ids: [uploadId] });
    expect((await owner.request('DELETE', `/space/upload-tokens/${uploadId}`, {})).status).toBe(
      204,
    );
    // Without its row, the token is just an empty space of its own: nothing lands in the
    // owner's library.
    await upload(phone);
    expect((await listPhotos(owner)).photos).toHaveLength(0);
  });

  it("can't be registered by a member", async () => {
    const memberToken = toBase64Url(randomBytes(16));
    const member = await owner.request('POST', '/space/members', {
      id: newId(),
      token: memberToken,
      meta: newMeta(),
    });
    expect(member.status).toBe(201);
    const friend = new Client(env);
    friend.cookie = owner.cookie;
    useSpace(friend, memberToken);
    const res = await friend.request('POST', '/space/upload-tokens', {
      id: newId(),
      token: toBase64Url(randomBytes(16)),
    });
    expect(res.status).toBe(403);
  });

  it('are limited per space, and refuse a token already in use', async () => {
    const taken = await owner.request('POST', '/space/upload-tokens', {
      id: newId(),
      token: uploadToken,
    });
    expect(taken.status).toBe(409);
    for (let i = 1; i < MAX_UPLOAD_TOKENS; i++) {
      const res = await owner.request('POST', '/space/upload-tokens', {
        id: newId(),
        token: toBase64Url(randomBytes(16)),
      });
      expect(res.status).toBe(201);
    }
    const over = await owner.request('POST', '/space/upload-tokens', {
      id: newId(),
      token: toBase64Url(randomBytes(16)),
    });
    expect(over.status).toBe(409);
  });

  it('are forgotten with the upload key when the space is wiped', async () => {
    await owner.request('PUT', '/space/upload-key', { meta: newMeta() });
    expect((await owner.request('DELETE', '/space', {})).status).toBe(204);
    const count = (table: string) =>
      (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
    expect(count('upload_keys')).toBe(0);
    expect(count('upload_tokens')).toBe(0);
  });

  it('need a session like everything else', async () => {
    const stranger = new Client(env);
    useSpace(stranger, uploadToken);
    expect((await stranger.request('POST', '/space/photos', {})).status).toBe(401);
  });
});
