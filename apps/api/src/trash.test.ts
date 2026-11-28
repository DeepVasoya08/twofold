import { randomBytes, toBase64Url } from '@arcafold/crypto/webcrypto';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import { SPACE_HEADER, TRASH_BATCH_MAX } from '@arcafold/types';
import type { MemberAccess, PhotoPage, StoredPhoto, TrashResponse } from '@arcafold/types';

import type { Env } from './env';
import { PAGE_SIZE } from './routes/space';
import { createTestCounters } from './test/counters';
import type { TestCounters } from './test/counters';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';
import { createTestR2 } from './test/r2';

let env: Env;
let counters: TestCounters;
let sqlite: DatabaseSync;
let owner: Client;
let guest: Client;
let token: string;

const random = (bytes: number) => toBase64Url(randomBytes(bytes));
const newId = () => random(16);
const newMeta = () => random(300);

async function signUp(email: string): Promise<Client> {
  const client = new Client(env);
  const keyring = await makeKeyring([newLoginKey(), newLoginKey(), newLoginKey()]);
  await client.request('POST', '/auth/signup', { email, name: 'Someone', keyring });
  return client;
}

function useSpace(c: Client, spaceToken: string): void {
  c.headers = { [SPACE_HEADER]: spaceToken };
}

beforeEach(async () => {
  const db = createTestDb();
  sqlite = db.sqlite;
  counters = createTestCounters();
  env = { DB: db.db, BLOBS: createTestR2().bucket, COUNTERS: counters.namespace };
  owner = await signUp('sam@example.com');
  guest = await signUp('kim@example.com');
  token = random(16);
  useSpace(owner, token);
});

function putFile(c: Client, id: string, part: 'thumb' | 'full', data: Uint8Array) {
  return c.send('PUT', `/space/photos/${id}/${part}`, new Uint8Array(data), {
    'content-type': 'application/octet-stream',
    'content-length': String(data.length),
  });
}

async function upload(c = owner): Promise<StoredPhoto> {
  const thumb = randomBytes(100);
  const full = randomBytes(1000);
  const photo = { id: newId(), meta: newMeta(), thumbSize: thumb.length, fullSize: full.length };
  expect((await c.request('POST', '/space/photos', photo)).status).toBe(201);
  expect((await putFile(c, photo.id, 'thumb', thumb)).status).toBe(200);
  expect((await putFile(c, photo.id, 'full', full)).status).toBe(200);
  return photo;
}

async function move(path: '/space/trash' | '/space/trash/restore', ids: string[], c = owner) {
  const res = await c.request('POST', path, { photos: ids.map((id) => ({ id, meta: newMeta() })) });
  return res.status === 200 ? (await res.json<TrashResponse>()).photoIds : res.status;
}

const trash = (ids: string[], c = owner) => move('/space/trash', ids, c);
const restore = (ids: string[], c = owner) => move('/space/trash/restore', ids, c);

async function ids(path: string, c = owner): Promise<string[]> {
  const res = await c.request('GET', path);
  expect(res.status).toBe(200);
  return (await res.json<PhotoPage>()).photos.map((photo) => photo.id);
}

const library = (c = owner) => ids('/space/photos', c);
const deleted = (c = owner) => ids('/space/trash', c);
const samId = () =>
  (
    sqlite.prepare("SELECT id FROM accounts WHERE email = 'sam@example.com'").get() as {
      id: string;
    }
  ).id;
const stored = () => counters.stored(samId());

async function share(extra: { access?: MemberAccess; album?: string }) {
  const member = { id: newId(), token: random(16), meta: newMeta(), ...extra };
  expect((await owner.request('POST', '/space/members', member)).status).toBe(201);
  useSpace(guest, member.token);
}

describe('Recently deleted', () => {
  it('moves photos out of the library and back, with their new sealed metadata', async () => {
    const kept = await upload();
    const photo = await upload();
    const meta = newMeta();
    const res = await owner.request('POST', '/space/trash', { photos: [{ id: photo.id, meta }] });
    expect(await res.json<TrashResponse>()).toEqual({ photoIds: [photo.id] });
    expect(await library()).toEqual([kept.id]);
    const page = await (await owner.request('GET', '/space/trash')).json<PhotoPage>();
    expect(page).toEqual({ photos: [{ ...photo, meta }], next: null });

    expect(await restore([photo.id])).toEqual([photo.id]);
    expect((await library()).sort()).toEqual([kept.id, photo.id].sort());
    expect(await deleted()).toEqual([]);
  });

  it('keeps the files, so a restored photo downloads as before', async () => {
    const photo = await upload();
    await trash([photo.id]);
    const res = await owner.request('GET', `/space/photos/${photo.id}/full`);
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(photo.fullSize);
  });

  it('keeps counting deleted photos against storage until they are gone for good', async () => {
    const photo = await upload();
    const before = stored();
    await trash([photo.id]);
    expect(stored()).toBe(before);
    expect((await owner.request('DELETE', `/space/photos/${photo.id}`, {})).status).toBe(204);
    expect(stored()).toBe(before - photo.thumbSize - photo.fullSize);
    expect(await deleted()).toEqual([]);
  });

  it('stores no date: only a flag, and the sealed metadata the device sent', async () => {
    const photo = await upload();
    await trash([photo.id]);
    const columns = sqlite.prepare('PRAGMA table_info(photos)').all() as { name: string }[];
    expect(columns.map((column) => column.name)).toEqual([
      'id',
      'space',
      'meta',
      'thumb_size',
      'full_size',
      'pending_since',
      'trashed',
      'sealed_for_owner',
      'sealed_for_album',
    ]);
  });

  it('reports only the photos it moved', async () => {
    const photo = await upload();
    const missing = newId();
    expect(await trash([photo.id, missing])).toEqual([photo.id]);
    expect(await trash([photo.id])).toEqual([]);
    expect(await restore([photo.id, missing])).toEqual([photo.id]);
    expect(await restore([photo.id])).toEqual([]);
  });

  it('leaves uploads in progress and other spaces’ photos alone', async () => {
    const pending = { id: newId(), meta: newMeta(), thumbSize: 100, fullSize: 1000 };
    expect((await owner.request('POST', '/space/photos', pending)).status).toBe(201);
    const other = await upload();
    useSpace(owner, random(16));
    expect(await trash([pending.id, other.id])).toEqual([]);
    useSpace(owner, token);
    expect(await trash([pending.id])).toEqual([]);
    expect(await library()).toEqual([other.id]);
  });

  it('pages through deleted photos in id order', async () => {
    const all: string[] = [];
    for (let index = 0; index < 3; index += 1) all.push((await upload()).id);
    sqlite.prepare('UPDATE photos SET trashed = 1').run();
    expect(await deleted()).toEqual([...all].sort());
    const after = [...all].sort()[0] ?? '';
    expect(await ids(`/space/trash?after=${after}`)).toEqual([...all].sort().slice(1));
    expect(PAGE_SIZE).toBe(500);
  });

  it('refuses malformed requests', async () => {
    const photo = await upload();
    const bad: unknown[] = [
      {},
      { photos: [] },
      { photos: [{ id: photo.id }] },
      { photos: [{ id: 'nope', meta: newMeta() }] },
      { photos: [{ id: photo.id, meta: '' }] },
      { photos: [{ id: photo.id, meta: newMeta(), extra: 1 }] },
      {
        photos: [
          { id: photo.id, meta: newMeta() },
          { id: photo.id, meta: newMeta() },
        ],
      },
      {
        photos: Array.from({ length: TRASH_BATCH_MAX + 1 }, () => ({
          id: newId(),
          meta: newMeta(),
        })),
      },
    ];
    for (const body of bad) {
      expect((await owner.request('POST', '/space/trash', body)).status).toBe(400);
      expect((await owner.request('POST', '/space/trash/restore', body)).status).toBe(400);
    }
    expect((await owner.request('GET', '/space/trash?after=nope')).status).toBe(400);
    expect(await library()).toEqual([photo.id]);
  });
});

describe('Recently deleted with members', () => {
  it('lets a member who can edit see, delete and restore', async () => {
    const photo = await upload();
    await share({ access: 'edit' });
    expect(await trash([photo.id], guest)).toEqual([photo.id]);
    expect(await deleted(guest)).toEqual([photo.id]);
    expect(await deleted()).toEqual([photo.id]);
    expect(await restore([photo.id], guest)).toEqual([photo.id]);
    expect(await library()).toEqual([photo.id]);
  });

  it('keeps it from view-only members, who can’t change anything', async () => {
    const photo = await upload();
    await share({ access: 'view' });
    expect(await trash([photo.id], guest)).toBe(403);
    await trash([photo.id]);
    expect(await library(guest)).toEqual([]);
    expect((await guest.request('GET', '/space/trash')).status).toBe(403);
    expect(await restore([photo.id], guest)).toBe(403);
    expect(await deleted()).toEqual([photo.id]);
  });

  it('hides deleted photos from a shared album until they are restored', async () => {
    const photo = await upload();
    const album = newId();
    expect(
      (await owner.request('POST', '/space/albums', { id: album, meta: newMeta() })).status,
    ).toBe(201);
    await owner.request('PUT', `/space/albums/${album}/shared`, { meta: newMeta() });
    await owner.request('PUT', `/space/albums/${album}/items/${photo.id}`, { meta: newMeta() });
    await share({ album });
    expect(await library(guest)).toEqual([photo.id]);

    await trash([photo.id]);
    expect(await library(guest)).toEqual([]);
    expect((await guest.request('GET', `/space/photos/${photo.id}/full`)).status).toBe(404);
    expect((await guest.request('GET', '/space/trash')).status).toBe(403);
    expect(await trash([photo.id], guest)).toBe(403);
    // The album still lists it, so restoring brings it straight back.
    const items = await owner.request('GET', `/space/albums/${album}/items`);
    expect(await items.json()).toEqual({ photoIds: [photo.id] });

    await restore([photo.id]);
    expect(await library(guest)).toEqual([photo.id]);
  });
});
