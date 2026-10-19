import { fromBase64Url, randomBytes, sha256, toBase64Url } from '@twofold/crypto/webcrypto';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import { SPACE_HEADER, STORAGE_SIZES, THUMB_BATCH_MAX, readThumbBatch } from '@twofold/types';
import type { AlbumList, PhotoPage, StoredPhoto } from '@twofold/types';

import type { Env } from './env';
import { PAGE_SIZE, PENDING_TTL_MS } from './routes/space';
import { STALE_PENDING_SQL } from './space-db';
import { createTestDb } from './test/d1';
import type { RoundTrips } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';
import { createTestR2 } from './test/r2';
import type { TestR2 } from './test/r2';

let env: Env;
let sqlite: DatabaseSync;
let r2: TestR2;
let client: Client;
let token: string;
let trips: RoundTrips;

const newId = () => toBase64Url(randomBytes(16));
const newMeta = () => toBase64Url(randomBytes(300));

function useSpace(c: Client, spaceToken: string): void {
  c.headers = { [SPACE_HEADER]: spaceToken };
}

beforeEach(async () => {
  const db = createTestDb();
  const blobs = createTestR2();
  sqlite = db.sqlite;
  trips = db.trips;
  r2 = blobs.r2;
  env = { DB: db.db, BLOBS: blobs.bucket };
  client = new Client(env);
  const keyring = await makeKeyring([newLoginKey(), newLoginKey(), newLoginKey()]);
  await client.request('POST', '/auth/signup', { email: 'sam@example.com', name: 'Sam', keyring });
  token = toBase64Url(randomBytes(16));
  useSpace(client, token);
});

function putFile(c: Client, id: string, part: 'thumb' | 'full', data: Uint8Array) {
  return c.send('PUT', `/space/photos/${id}/${part}`, new Uint8Array(data), {
    'content-type': 'application/octet-stream',
    'content-length': String(data.length),
  });
}

/** Uploads and commits a photo with random contents. */
async function upload(
  c = client,
): Promise<{ photo: StoredPhoto; thumb: Uint8Array; full: Uint8Array }> {
  const thumb = randomBytes(100);
  const full = randomBytes(1000);
  const photo = { id: newId(), meta: newMeta(), thumbSize: thumb.length, fullSize: full.length };
  expect((await c.request('POST', '/space/photos', photo)).status).toBe(201);
  expect((await putFile(c, photo.id, 'thumb', thumb)).status).toBe(204);
  expect((await putFile(c, photo.id, 'full', full)).status).toBe(204);
  expect((await c.request('POST', `/space/photos/${photo.id}/commit`, {})).status).toBe(204);
  return { photo, thumb, full };
}

async function listPhotos(c = client, after?: string): Promise<PhotoPage> {
  const res = await c.request('GET', `/space/photos${after ? `?after=${after}` : ''}`);
  expect(res.status).toBe(200);
  return res.json<PhotoPage>();
}

describe('access', () => {
  it('needs a session', async () => {
    const stranger = new Client(env);
    useSpace(stranger, token);
    expect((await stranger.request('GET', '/space/photos')).status).toBe(401);
  });

  it('needs a well-formed space token', async () => {
    for (const bad of [
      undefined,
      'short',
      toBase64Url(randomBytes(32)),
      `${token.slice(0, 21)}!`,
    ]) {
      client.headers = bad === undefined ? {} : { [SPACE_HEADER]: bad };
      expect((await client.request('GET', '/space/photos')).status).toBe(400);
    }
  });

  it('keeps each space to itself, even for the same session', async () => {
    const { photo } = await upload();
    useSpace(client, toBase64Url(randomBytes(16)));
    expect((await listPhotos()).photos).toEqual([]);
    expect((await client.request('GET', `/space/photos/${photo.id}/full`)).status).toBe(404);
    expect(
      (await client.request('PUT', `/space/photos/${photo.id}`, { meta: newMeta() })).status,
    ).toBe(404);
    expect((await client.request('DELETE', `/space/photos/${photo.id}`, {})).status).toBe(404);
    useSpace(client, token);
    expect((await listPhotos()).photos).toEqual([photo]);
  });

  it('lets any signed-in account reach a space by its token, without recording who', async () => {
    const { photo } = await upload();
    const other = new Client(env);
    const keyring = await makeKeyring([newLoginKey(), newLoginKey(), newLoginKey()]);
    await other.request('POST', '/auth/signup', { email: 'kim@example.com', name: 'Kim', keyring });
    useSpace(other, token);
    expect((await listPhotos(other)).photos).toEqual([photo]);
  });
});

describe('what the database keeps', () => {
  it('stores no account and only a hash of the space token', async () => {
    await upload();
    const tag = toBase64Url(await sha256(fromBase64Url(token) ?? new Uint8Array()));
    const columns = sqlite
      .prepare("SELECT name FROM pragma_table_info('photos')")
      .all()
      .map((row) => row.name);
    expect(columns).not.toContain('account_id');
    const rows = sqlite.prepare('SELECT space, pending_since FROM photos').all();
    expect(rows).toEqual([{ space: tag, pending_since: null }]);
    expect(JSON.stringify(sqlite.prepare('SELECT * FROM photos').all())).not.toContain(token);
  });

  it('names R2 objects by the random photo id only', async () => {
    const { photo } = await upload();
    expect([...r2.objects.keys()].sort()).toEqual([
      `photos/${photo.id}/full`,
      `photos/${photo.id}/thumb`,
    ]);
  });
});

describe('uploading', () => {
  it('stores both files and serves them back byte for byte', async () => {
    const { photo, thumb, full } = await upload();
    const thumbRes = await client.request('GET', `/space/photos/${photo.id}/thumb`);
    expect(thumbRes.headers.get('content-type')).toBe('application/octet-stream');
    expect(thumbRes.headers.get('cache-control')).toBe('no-store');
    expect(new Uint8Array(await thumbRes.arrayBuffer())).toEqual(thumb);
    const fullRes = await client.request('GET', `/space/photos/${photo.id}/full`);
    expect(new Uint8Array(await fullRes.arrayBuffer())).toEqual(full);
  });

  it('hides a photo until it is committed, and refuses to commit missing files', async () => {
    const photo = { id: newId(), meta: newMeta(), thumbSize: 10, fullSize: 20 };
    await client.request('POST', '/space/photos', photo);
    expect((await listPhotos()).photos).toEqual([]);
    expect((await client.request('GET', `/space/photos/${photo.id}/thumb`)).status).toBe(404);
    await putFile(client, photo.id, 'thumb', randomBytes(10));
    expect((await client.request('POST', `/space/photos/${photo.id}/commit`, {})).status).toBe(409);
    await putFile(client, photo.id, 'full', randomBytes(20));
    expect((await client.request('POST', `/space/photos/${photo.id}/commit`, {})).status).toBe(204);
    expect((await listPhotos()).photos).toEqual([photo]);
  });

  it('refuses files that differ from the declared size', async () => {
    const photo = { id: newId(), meta: newMeta(), thumbSize: 10, fullSize: 20 };
    await client.request('POST', '/space/photos', photo);
    expect((await putFile(client, photo.id, 'thumb', randomBytes(11))).status).toBe(400);
    const lying = await client.send('PUT', `/space/photos/${photo.id}/thumb`, randomBytes(11), {
      'content-type': 'application/octet-stream',
      'content-length': '10',
    });
    expect(lying.status).toBe(400);
    expect(r2.objects.size).toBe(0);
  });

  it('refuses to overwrite the files of a committed photo', async () => {
    const { photo } = await upload();
    expect((await putFile(client, photo.id, 'thumb', randomBytes(100))).status).toBe(404);
  });

  it('refuses a taken id, bad parts and oversized or malformed requests', async () => {
    const { photo } = await upload();
    expect((await client.request('POST', '/space/photos', photo)).status).toBe(409);
    const fresh = { id: newId(), meta: newMeta(), thumbSize: 10, fullSize: 20 };
    for (const bad of [
      { ...fresh, id: 'not-an-id' },
      { ...fresh, meta: '' },
      { ...fresh, meta: 'A'.repeat(4000) },
      { ...fresh, thumbSize: 2 * 1024 * 1024 },
      { ...fresh, fullSize: 0 },
      { ...fresh, fullSize: 65 * 1024 * 1024 },
      { ...fresh, extra: true },
    ]) {
      expect((await client.request('POST', '/space/photos', bad)).status).toBe(400);
    }
    await client.request('POST', '/space/photos', fresh);
    expect((await putFile(client, fresh.id, 'original' as 'full', randomBytes(20))).status).toBe(
      400,
    );
    const form = await client.send('PUT', `/space/photos/${fresh.id}/full`, 'x', {
      'content-type': 'text/plain',
    });
    expect(form.status).toBe(415);
  });

  it('cleans up abandoned uploads in the same space', async () => {
    const stale = { id: newId(), meta: newMeta(), thumbSize: 10, fullSize: 20 };
    await client.request('POST', '/space/photos', stale);
    await putFile(client, stale.id, 'thumb', randomBytes(10));
    sqlite
      .prepare('UPDATE photos SET pending_since = ? WHERE id = ?')
      .run(Date.now() - PENDING_TTL_MS - 1, stale.id);
    await upload();
    expect(sqlite.prepare('SELECT id FROM photos WHERE id = ?').get(stale.id)).toBeUndefined();
    expect(r2.objects.has(`photos/${stale.id}/thumb`)).toBe(false);
  });

  it('finds abandoned uploads without reading the space’s other photos', () => {
    const plan = sqlite
      .prepare(`EXPLAIN QUERY PLAN ${STALE_PENDING_SQL}`)
      .all('space', 0)
      .map((row) => String(row.detail));
    expect(plan).toEqual([
      'SEARCH photos USING INDEX photos_pending (space=? AND pending_since<?)',
    ]);
  });
});

async function getThumbs(ids: string[], c = client) {
  const res = await c.request('GET', `/space/thumbs?ids=${ids.join(',')}`);
  if (res.status !== 200) return res.status;
  return readThumbBatch(new Uint8Array(await res.arrayBuffer()), ids.length);
}

describe('thumbnail batches', () => {
  it('returns many thumbnails in the order asked', async () => {
    const first = await upload();
    const second = await upload();
    expect(await getThumbs([second.photo.id, first.photo.id])).toEqual([second.thumb, first.thumb]);
  });

  it('reads a full batch without holding more R2 bodies open than a Worker may', async () => {
    const photos = [];
    for (let index = 0; index < 19; index += 1) photos.push(await upload());
    expect(await getThumbs(photos.map(({ photo }) => photo.id))).toEqual(
      photos.map(({ thumb }) => thumb),
    );
    expect(r2.unread).toHaveLength(0);
  });

  it('leaves out photos that are missing, still uploading or in another space', async () => {
    const mine = await upload();
    const pending = { id: newId(), meta: newMeta(), thumbSize: 10, fullSize: 20 };
    await client.request('POST', '/space/photos', pending);
    await putFile(client, pending.id, 'thumb', randomBytes(10));
    useSpace(client, toBase64Url(randomBytes(16)));
    const elsewhere = await upload();
    useSpace(client, token);
    expect(await getThumbs([mine.photo.id, pending.id, elsewhere.photo.id, newId()])).toEqual([
      mine.thumb,
      null,
      null,
      null,
    ]);
  });

  it('refuses malformed, repeated or too many ids', async () => {
    expect(await getThumbs([])).toBe(400);
    expect(await getThumbs(['not-an-id'])).toBe(400);
    const id = newId();
    expect(await getThumbs([id, id])).toBe(400);
    expect(await getThumbs(Array.from({ length: THUMB_BATCH_MAX + 1 }, newId))).toBe(400);
    expect(await getThumbs(Array.from({ length: THUMB_BATCH_MAX }, newId))).toHaveLength(
      THUMB_BATCH_MAX,
    );
  });

  it('needs a session like every space route', async () => {
    client.cookie = null;
    expect(await getThumbs([newId()])).toBe(401);
  });
});

describe('database round trips', () => {
  async function tripsFor(request: () => Promise<Response>): Promise<number> {
    const before = trips.count;
    await request();
    return trips.count - before;
  }

  it('checks the session and the space together, then answers in one more', async () => {
    const { photo } = await upload();
    expect(await tripsFor(() => client.request('GET', `/space/thumbs?ids=${photo.id}`))).toBe(2);
    expect(await tripsFor(() => client.request('GET', `/space/photos/${photo.id}/full`))).toBe(2);
    expect(await tripsFor(() => client.request('GET', '/space/photos'))).toBe(2);
  });

  it('uploads a photo in ten round trips across its four requests', async () => {
    // Two of them (the abandoned-upload check and the quota reservation) run side by side.
    const before = trips.count;
    await upload();
    expect(trips.count - before).toBe(10);
  });
});

describe('listing', () => {
  it('pages through photos in id order', async () => {
    const insert = sqlite.prepare(
      'INSERT INTO photos (id, space, meta, thumb_size, full_size) VALUES (?, ?, ?, 1, 1)',
    );
    const tag = toBase64Url(await sha256(fromBase64Url(token) ?? new Uint8Array()));
    const ids = Array.from({ length: PAGE_SIZE + 3 }, newId);
    for (const id of ids) insert.run(id, tag, newMeta());
    const first = await listPhotos();
    expect(first.photos).toHaveLength(PAGE_SIZE);
    expect(first.next).not.toBeNull();
    const second = await listPhotos(client, first.next ?? '');
    expect(second.photos).toHaveLength(3);
    expect(second.next).toBeNull();
    expect([...first.photos, ...second.photos].map((p) => p.id)).toEqual(ids.sort());
  });

  it('refuses a malformed cursor', async () => {
    expect((await client.request('GET', '/space/photos?after=bad')).status).toBe(400);
  });
});

describe('changing and deleting', () => {
  it('replaces a photo’s sealed metadata', async () => {
    const { photo } = await upload();
    const meta = newMeta();
    expect((await client.request('PUT', `/space/photos/${photo.id}`, { meta })).status).toBe(204);
    expect((await listPhotos()).photos).toEqual([{ ...photo, meta }]);
  });

  it('deletes a photo and its files', async () => {
    const { photo } = await upload();
    const kept = await upload();
    expect((await client.request('DELETE', `/space/photos/${photo.id}`, {})).status).toBe(204);
    expect((await listPhotos()).photos).toEqual([kept.photo]);
    expect(r2.objects.has(`photos/${photo.id}/full`)).toBe(false);
    expect(r2.objects.has(`photos/${kept.photo.id}/full`)).toBe(true);
  });

  it('wipes a whole space and nothing else', async () => {
    await upload();
    await client.request('POST', '/space/albums', { id: newId(), meta: newMeta() });
    const otherToken = toBase64Url(randomBytes(16));
    useSpace(client, otherToken);
    const other = await upload();
    useSpace(client, token);
    expect((await client.request('DELETE', '/space', {})).status).toBe(204);
    expect((await listPhotos()).photos).toEqual([]);
    const albums = await client.request('GET', '/space/albums');
    expect((await albums.json<AlbumList>()).albums).toEqual([]);
    expect([...r2.objects.keys()].every((key) => key.includes(other.photo.id))).toBe(true);
    useSpace(client, otherToken);
    expect((await listPhotos()).photos).toEqual([other.photo]);
  });
});

describe('albums', () => {
  it('creates and lists albums', async () => {
    const album = { id: newId(), meta: newMeta() };
    expect((await client.request('POST', '/space/albums', album)).status).toBe(201);
    expect((await client.request('POST', '/space/albums', album)).status).toBe(409);
    const res = await client.request('GET', '/space/albums');
    expect(await res.json<AlbumList>()).toEqual({ albums: [album] });
  });

  it('refuses a malformed album', async () => {
    expect((await client.request('POST', '/space/albums', { id: newId() })).status).toBe(400);
  });

  it('renames an album by replacing its sealed metadata', async () => {
    const album = { id: newId(), meta: newMeta() };
    await client.request('POST', '/space/albums', album);
    const meta = newMeta();
    expect((await client.request('PUT', `/space/albums/${album.id}`, { meta })).status).toBe(204);
    const res = await client.request('GET', '/space/albums');
    expect(await res.json<AlbumList>()).toEqual({ albums: [{ id: album.id, meta }] });
    expect((await client.request('PUT', `/space/albums/${album.id}`, {})).status).toBe(400);
    expect((await client.request('PUT', `/space/albums/${newId()}`, { meta })).status).toBe(404);
  });

  it('deletes one album and keeps its photos', async () => {
    const { photo } = await upload();
    const album = { id: newId(), meta: newMeta() };
    const other = { id: newId(), meta: newMeta() };
    await client.request('POST', '/space/albums', album);
    await client.request('POST', '/space/albums', other);
    expect((await client.request('DELETE', `/space/albums/${album.id}`, {})).status).toBe(204);
    expect((await client.request('DELETE', `/space/albums/${album.id}`, {})).status).toBe(404);
    const res = await client.request('GET', '/space/albums');
    expect(await res.json<AlbumList>()).toEqual({ albums: [other] });
    expect((await listPhotos()).photos).toEqual([photo]);
  });

  it('can’t rename or delete another space’s album', async () => {
    const album = { id: newId(), meta: newMeta() };
    await client.request('POST', '/space/albums', album);
    useSpace(client, toBase64Url(randomBytes(16)));
    const path = `/space/albums/${album.id}`;
    expect((await client.request('PUT', path, { meta: newMeta() })).status).toBe(404);
    expect((await client.request('DELETE', path, {})).status).toBe(404);
    useSpace(client, token);
    const res = await client.request('GET', '/space/albums');
    expect(await res.json<AlbumList>()).toEqual({ albums: [album] });
  });
});

describe('storage quota', () => {
  const QUOTA = STORAGE_SIZES.accountQuota;
  const stored = () =>
    (sqlite.prepare('SELECT stored_bytes FROM accounts').get() as { stored_bytes: number })
      .stored_bytes;
  const setStored = (bytes: number) => {
    sqlite.prepare('UPDATE accounts SET stored_bytes = ?').run(bytes);
  };
  const start = (size = 1000) =>
    client.request('POST', '/space/photos', {
      id: newId(),
      meta: newMeta(),
      thumbSize: 100,
      fullSize: size,
    });

  it('counts both files of every upload, in every space the account uses', async () => {
    await upload();
    useSpace(client, toBase64Url(randomBytes(16)));
    await upload();
    expect(stored()).toBe(2 * 1100);
    expect(QUOTA).toBe(1024 * 1024 * 1024);
  });

  it('refuses an upload that would go over, and stores nothing for it', async () => {
    setStored(QUOTA - 1099);
    const res = await start();
    expect(res.status).toBe(413);
    expect((await res.json<{ error: string }>()).error).toMatch(/storage is full/);
    expect(sqlite.prepare('SELECT * FROM photos').all()).toEqual([]);
    expect(stored()).toBe(QUOTA - 1099);
    setStored(QUOTA - 1100);
    expect((await start()).status).toBe(201);
    expect(stored()).toBe(QUOTA);
  });

  it('can’t be raced: parallel uploads together stay within the quota', async () => {
    setStored(QUOTA - 2500);
    const results = await Promise.all(Array.from({ length: 10 }, () => start()));
    expect(results.filter((res) => res.status === 201)).toHaveLength(2);
    expect(results.filter((res) => res.status === 413)).toHaveLength(8);
    expect(stored()).toBe(QUOTA - 300);
  });

  it('gives the bytes back when a photo, an abandoned upload or a whole space is deleted', async () => {
    const { photo } = await upload();
    await upload();
    expect((await client.request('DELETE', `/space/photos/${photo.id}`, {})).status).toBe(204);
    expect(stored()).toBe(1100);
    // Deleting it again gives nothing back twice.
    expect((await client.request('DELETE', `/space/photos/${photo.id}`, {})).status).toBe(404);
    expect(stored()).toBe(1100);
    expect((await start()).status).toBe(201);
    sqlite.prepare('UPDATE photos SET pending_since = 0 WHERE pending_since IS NOT NULL').run();
    expect((await start()).status).toBe(201);
    expect(stored()).toBe(2 * 1100);
    expect((await client.request('DELETE', '/space', {})).status).toBe(204);
    expect(stored()).toBe(0);
  });

  it('gives the bytes back when an upload’s id is taken', async () => {
    const { photo } = await upload();
    const res = await client.request('POST', '/space/photos', {
      id: photo.id,
      meta: newMeta(),
      thumbSize: 100,
      fullSize: 1000,
    });
    expect(res.status).toBe(409);
    expect(stored()).toBe(1100);
  });

  it('is per account: another account’s uploads don’t count', async () => {
    setStored(QUOTA);
    const other = new Client(env);
    const keyring = await makeKeyring([newLoginKey(), newLoginKey(), newLoginKey()]);
    await other.request('POST', '/auth/signup', { email: 'kim@example.com', name: 'Kim', keyring });
    useSpace(other, toBase64Url(randomBytes(16)));
    await upload(other);
    expect((await start()).status).toBe(413);
  });
});
