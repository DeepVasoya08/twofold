import { randomBytes, toBase64Url } from '@twofold/crypto/webcrypto';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_SEARCH_SEGMENTS,
  MAX_SMART_ALBUMS,
  MAX_WORDS,
  SEARCH_SEGMENT_PAGE,
  SEARCH_SIZES,
  SPACE_HEADER,
  STORAGE_SIZES,
} from '@twofold/types';
import type { SearchSegmentPage, SmartAlbumList, WordList } from '@twofold/types';

import type { Env } from './env';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';
import { createTestR2 } from './test/r2';

let env: Env;
let sqlite: DatabaseSync;
let client: Client;

const newId = () => toBase64Url(randomBytes(16));
const segmentData = (size = 1000) => toBase64Url(randomBytes(size));

function useSpace(c: Client, token: string): void {
  c.headers = { [SPACE_HEADER]: token };
}

async function signUp(email: string): Promise<Client> {
  const c = new Client(env);
  const keyring = await makeKeyring([newLoginKey(), newLoginKey(), newLoginKey()]);
  await c.request('POST', '/auth/signup', { email, name: 'Someone', keyring });
  return c;
}

const stored = () =>
  (sqlite.prepare('SELECT stored_bytes FROM accounts LIMIT 1').get() as { stored_bytes: number })
    .stored_bytes;

beforeEach(async () => {
  const db = createTestDb();
  sqlite = db.sqlite;
  env = { DB: db.db, BLOBS: createTestR2().bucket };
  client = await signUp('sam@example.com');
  useSpace(client, toBase64Url(randomBytes(16)));
});

async function segments(c = client, after?: string): Promise<SearchSegmentPage> {
  const res = await c.request('GET', `/space/search${after ? `?after=${after}` : ''}`);
  expect(res.status).toBe(200);
  return res.json<SearchSegmentPage>();
}

const put = (id: string, data: string, c = client) =>
  c.request('PUT', `/space/search/${id}`, { data });

const newMeta = () => toBase64Url(randomBytes(400));

async function words(c = client): Promise<WordList['words']> {
  const res = await c.request('GET', '/space/words');
  expect(res.status).toBe(200);
  return (await res.json<WordList>()).words;
}

const putWord = (id: string, meta: string, c = client) =>
  c.request('PUT', `/space/words/${id}`, { meta });

describe('search segments', () => {
  it('are stored per space and listed back in pages', async () => {
    const added: { id: string; data: string }[] = [];
    for (let i = 0; i < SEARCH_SEGMENT_PAGE + 2; i++) {
      const segment = { id: newId(), data: segmentData(100) };
      expect((await put(segment.id, segment.data)).status).toBe(201);
      added.push(segment);
    }
    const first = await segments();
    expect(first.segments).toHaveLength(SEARCH_SEGMENT_PAGE);
    expect(first.next).not.toBeNull();
    const second = await segments(client, first.next ?? '');
    expect(second.next).toBeNull();
    expect([...first.segments, ...second.segments]).toEqual(
      [...added].sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
    // Another space of the same account (the other password's space) sees none of them.
    useSpace(client, toBase64Url(randomBytes(16)));
    expect((await segments()).segments).toEqual([]);
  });

  it('are kept apart from face segments', async () => {
    const id = newId();
    await put(id, segmentData(100));
    const faces = await client.request('GET', '/space/faces');
    expect((await faces.json<SearchSegmentPage>()).segments).toEqual([]);
    expect((await segments()).segments.map((segment) => segment.id)).toEqual([id]);
  });

  it('count against storage until deleted', async () => {
    const a = newId();
    const b = newId();
    await put(a, segmentData(1000));
    await put(b, segmentData(500));
    expect(stored()).toBe(1500);
    expect((await client.request('DELETE', '/space/search', { ids: [a, newId()] })).status).toBe(
      204,
    );
    expect(stored()).toBe(500);
    await client.request('DELETE', '/space/search', { ids: [a] });
    expect(stored()).toBe(500);
    expect((await segments()).segments.map((segment) => segment.id)).toEqual([b]);
  });

  it('never replace one another', async () => {
    const id = newId();
    await put(id, segmentData(100));
    expect((await put(id, segmentData(200))).status).toBe(409);
    expect(stored()).toBe(100);
  });

  it('are refused when storage is full, or too many are waiting', async () => {
    sqlite.prepare('UPDATE accounts SET stored_bytes = ?').run(STORAGE_SIZES.accountQuota - 10);
    expect((await put(newId(), segmentData(100))).status).toBe(413);
    sqlite.prepare('UPDATE accounts SET stored_bytes = 0').run();
    await put(newId(), segmentData(100));
    const insert = sqlite.prepare(
      'INSERT INTO search_segments (space, id, data, size) VALUES ((SELECT space FROM search_segments LIMIT 1), ?, ?, 1)',
    );
    for (let i = 1; i < MAX_SEARCH_SEGMENTS; i++) insert.run(newId(), 'x');
    expect((await put(newId(), segmentData(100))).status).toBe(409);
  });

  it('refuse malformed and oversized data', async () => {
    for (const bad of [
      { data: 'not base64!' },
      { data: toBase64Url(new Uint8Array(SEARCH_SIZES.maxSegment + 1)) },
      { data: segmentData(), extra: true },
    ]) {
      expect((await client.request('PUT', `/space/search/${newId()}`, bad)).status).toBe(400);
    }
    expect((await put('short', segmentData())).status).toBe(400);
    expect((await client.request('DELETE', '/space/search', { ids: [] })).status).toBe(400);
    expect((await client.request('GET', '/space/search?after=bad')).status).toBe(400);
  });
});

describe('taught words', () => {
  it('are saved, changed and deleted, per space', async () => {
    const id = newId();
    const meta = newMeta();
    expect((await putWord(id, meta)).status).toBe(204);
    expect(await words()).toEqual([{ id, meta }]);
    const changed = newMeta();
    await putWord(id, changed);
    expect(await words()).toEqual([{ id, meta: changed }]);
    // The other password's space sees none of them.
    const own = client.headers;
    useSpace(client, toBase64Url(randomBytes(16)));
    expect(await words()).toEqual([]);
    client.headers = own;
    expect((await client.request('DELETE', `/space/words/${id}`, {})).status).toBe(204);
    expect(await words()).toEqual([]);
    expect((await client.request('DELETE', `/space/words/${id}`, {})).status).toBe(404);
  });

  it('stop at the limit, though ones already kept can still change', async () => {
    const first = newId();
    await putWord(first, newMeta());
    const tag = (sqlite.prepare('SELECT space FROM search_words').get() as { space: string }).space;
    const insert = sqlite.prepare('INSERT INTO search_words (space, id, meta) VALUES (?, ?, ?)');
    for (let i = 1; i < MAX_WORDS; i++) insert.run(tag, newId(), 'x');
    expect((await putWord(newId(), newMeta())).status).toBe(409);
    expect((await putWord(first, newMeta())).status).toBe(204);
  });

  it('refuse malformed requests', async () => {
    expect((await putWord('short', newMeta())).status).toBe(400);
    expect((await putWord(newId(), 'not base64!')).status).toBe(400);
    expect(
      (await client.request('PUT', `/space/words/${newId()}`, { meta: newMeta(), extra: 1 }))
        .status,
    ).toBe(400);
    expect((await client.request('DELETE', '/space/words/short', {})).status).toBe(400);
  });
});

describe('smart albums', () => {
  const putAlbum = (id: string, meta: string, c = client) =>
    c.request('PUT', `/space/smart-albums/${id}`, { meta });
  async function albums(c = client): Promise<SmartAlbumList['albums']> {
    const res = await c.request('GET', '/space/smart-albums');
    expect(res.status).toBe(200);
    return (await res.json<SmartAlbumList>()).albums;
  }

  it('are saved, changed and deleted, per space, apart from words', async () => {
    const id = newId();
    const meta = newMeta();
    expect((await putAlbum(id, meta)).status).toBe(204);
    expect(await albums()).toEqual([{ id, meta }]);
    expect(await words()).toEqual([]);
    const changed = newMeta();
    await putAlbum(id, changed);
    expect(await albums()).toEqual([{ id, meta: changed }]);
    const own = client.headers;
    useSpace(client, toBase64Url(randomBytes(16)));
    expect(await albums()).toEqual([]);
    client.headers = own;
    expect((await client.request('DELETE', `/space/smart-albums/${id}`, {})).status).toBe(204);
    expect((await client.request('DELETE', `/space/smart-albums/${id}`, {})).status).toBe(404);
  });

  it('stop at the limit', async () => {
    await putAlbum(newId(), newMeta());
    const tag = (sqlite.prepare('SELECT space FROM smart_albums').get() as { space: string }).space;
    const insert = sqlite.prepare('INSERT INTO smart_albums (space, id, meta) VALUES (?, ?, ?)');
    for (let i = 1; i < MAX_SMART_ALBUMS; i++) insert.run(tag, newId(), 'x');
    expect((await putAlbum(newId(), newMeta())).status).toBe(409);
  });

  it('go with the search data, and are only for the owner', async () => {
    await putAlbum(newId(), newMeta());
    expect((await client.request('DELETE', '/space/search-data', {})).status).toBe(204);
    expect(await albums()).toEqual([]);
    await putAlbum(newId(), newMeta());
    expect((await client.request('DELETE', '/space', {})).status).toBe(204);
    expect(await albums()).toEqual([]);

    const memberToken = toBase64Url(randomBytes(16));
    const member = { id: newId(), token: memberToken, meta: newMeta(), access: 'edit' };
    expect((await client.request('POST', '/space/members', member)).status).toBe(201);
    const guest = await signUp('kim@example.com');
    useSpace(guest, memberToken);
    expect((await guest.request('GET', '/space/smart-albums')).status).toBe(403);
    expect((await putAlbum(newId(), newMeta(), guest)).status).toBe(403);
  });
});

describe('search data', () => {
  it('is forgotten all at once, giving its storage back', async () => {
    await put(newId(), segmentData(800));
    await putWord(newId(), newMeta());
    await client.request('PUT', `/space/faces/${newId()}`, { data: segmentData(300) });
    expect((await client.request('DELETE', '/space/search-data', {})).status).toBe(204);
    expect((await segments()).segments).toEqual([]);
    expect(await words()).toEqual([]);
    // Face results stay.
    expect(stored()).toBe(300);
  });

  it('goes with the rest of the space when the space is wiped', async () => {
    await put(newId(), segmentData(800));
    await putWord(newId(), newMeta());
    expect((await client.request('DELETE', '/space', {})).status).toBe(204);
    expect((await segments()).segments).toEqual([]);
    expect(await words()).toEqual([]);
    expect(stored()).toBe(0);
  });

  it('is only for the space’s owner, never a member', async () => {
    for (const access of ['view', 'edit'] as const) {
      const memberToken = toBase64Url(randomBytes(16));
      const member = {
        id: newId(),
        token: memberToken,
        meta: toBase64Url(randomBytes(300)),
        access,
      };
      expect((await client.request('POST', '/space/members', member)).status).toBe(201);
      const guest = await signUp(`kim-${access}@example.com`);
      useSpace(guest, memberToken);
      const id = newId();
      expect((await guest.request('GET', '/space/search')).status).toBe(403);
      expect((await put(id, segmentData(), guest)).status).toBe(403);
      expect((await guest.request('DELETE', '/space/search', { ids: [id] })).status).toBe(403);
      expect((await guest.request('DELETE', '/space/search-data', {})).status).toBe(403);
      expect((await guest.request('GET', '/space/words')).status).toBe(403);
      expect((await putWord(id, newMeta(), guest)).status).toBe(403);
      expect((await guest.request('DELETE', `/space/words/${id}`, {})).status).toBe(403);
    }
  });
});
