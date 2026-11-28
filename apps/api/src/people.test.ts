import { randomBytes, toBase64Url } from '@arcafold/crypto/webcrypto';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  FACE_SEGMENT_PAGE,
  FACE_SIZES,
  MAX_FACE_SEGMENTS,
  MAX_PEOPLE,
  SPACE_HEADER,
  STORAGE_SIZES,
} from '@arcafold/types';
import type { FaceSegmentPage, PersonList } from '@arcafold/types';

import type { Env } from './env';
import { createTestCounters } from './test/counters';
import type { TestCounters } from './test/counters';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';
import { createTestR2 } from './test/r2';

let env: Env;
let counters: TestCounters;
let sqlite: DatabaseSync;
let client: Client;

const newId = () => toBase64Url(randomBytes(16));
const newMeta = () => toBase64Url(randomBytes(300));
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

const samId = () =>
  (
    sqlite.prepare("SELECT id FROM accounts WHERE email = 'sam@example.com'").get() as {
      id: string;
    }
  ).id;
const stored = () => counters.stored(samId());

beforeEach(async () => {
  const db = createTestDb();
  sqlite = db.sqlite;
  counters = createTestCounters();
  env = { DB: db.db, BLOBS: createTestR2().bucket, COUNTERS: counters.namespace };
  client = await signUp('sam@example.com');
  useSpace(client, toBase64Url(randomBytes(16)));
});

async function segments(c = client, after?: string): Promise<FaceSegmentPage> {
  const res = await c.request('GET', `/space/faces${after ? `?after=${after}` : ''}`);
  expect(res.status).toBe(200);
  return res.json<FaceSegmentPage>();
}

async function people(c = client): Promise<PersonList['people']> {
  const res = await c.request('GET', '/space/people');
  expect(res.status).toBe(200);
  return (await res.json<PersonList>()).people;
}

describe('face segments', () => {
  it('are stored per space and listed back in pages', async () => {
    const added: { id: string; data: string }[] = [];
    for (let i = 0; i < FACE_SEGMENT_PAGE + 2; i++) {
      const segment = { id: newId(), data: segmentData(100) };
      expect(
        (await client.request('PUT', `/space/faces/${segment.id}`, { data: segment.data })).status,
      ).toBe(201);
      added.push(segment);
    }
    const first = await segments();
    expect(first.segments).toHaveLength(FACE_SEGMENT_PAGE);
    expect(first.next).not.toBeNull();
    const second = await segments(client, first.next ?? '');
    expect(second.next).toBeNull();
    const all = [...first.segments, ...second.segments];
    expect(all).toEqual([...added].sort((a, b) => (a.id < b.id ? -1 : 1)));
    // Another space of the same account sees none of them.
    useSpace(client, toBase64Url(randomBytes(16)));
    expect((await segments()).segments).toEqual([]);
  });

  it('count against storage until deleted', async () => {
    const a = newId();
    const b = newId();
    await client.request('PUT', `/space/faces/${a}`, { data: segmentData(1000) });
    await client.request('PUT', `/space/faces/${b}`, { data: segmentData(500) });
    expect(stored()).toBe(1500);
    expect((await client.request('DELETE', '/space/faces', { ids: [a, newId()] })).status).toBe(
      204,
    );
    expect(stored()).toBe(500);
    // Deleting it again gives nothing back twice.
    await client.request('DELETE', '/space/faces', { ids: [a] });
    expect(stored()).toBe(500);
    expect((await segments()).segments.map((segment) => segment.id)).toEqual([b]);
  });

  it('never replace one another', async () => {
    const id = newId();
    await client.request('PUT', `/space/faces/${id}`, { data: segmentData(100) });
    expect(
      (await client.request('PUT', `/space/faces/${id}`, { data: segmentData(200) })).status,
    ).toBe(409);
    expect(stored()).toBe(100);
  });

  it('are refused when storage is full, or too many are waiting', async () => {
    counters.setStored(samId(), STORAGE_SIZES.accountQuota - 10);
    expect(
      (await client.request('PUT', `/space/faces/${newId()}`, { data: segmentData(100) })).status,
    ).toBe(413);
    counters.setStored(samId(), 0);
    const insert = sqlite.prepare(
      'INSERT INTO face_segments (space, id, data, size) VALUES ((SELECT space FROM face_segments LIMIT 1), ?, ?, 1)',
    );
    await client.request('PUT', `/space/faces/${newId()}`, { data: segmentData(100) });
    for (let i = 1; i < MAX_FACE_SEGMENTS; i++) insert.run(newId(), 'x');
    expect(
      (await client.request('PUT', `/space/faces/${newId()}`, { data: segmentData(100) })).status,
    ).toBe(409);
  });

  it('refuse malformed and oversized data', async () => {
    for (const bad of [
      { data: 'not base64!' },
      { data: toBase64Url(new Uint8Array(FACE_SIZES.maxSegment + 1)) },
      { data: segmentData(), extra: true },
    ]) {
      expect((await client.request('PUT', `/space/faces/${newId()}`, bad)).status).toBe(400);
    }
    expect(
      (await client.request('PUT', '/space/faces/short', { data: segmentData() })).status,
    ).toBe(400);
    expect((await client.request('DELETE', '/space/faces', { ids: [] })).status).toBe(400);
    expect((await client.request('GET', '/space/faces?after=bad')).status).toBe(400);
  });
});

describe('people', () => {
  it('are saved, replaced and deleted', async () => {
    const id = newId();
    const meta = newMeta();
    expect((await client.request('PUT', `/space/people/${id}`, { meta })).status).toBe(204);
    expect(await people()).toEqual([{ id, meta }]);
    const renamed = newMeta();
    await client.request('PUT', `/space/people/${id}`, { meta: renamed });
    expect(await people()).toEqual([{ id, meta: renamed }]);
    expect((await client.request('DELETE', `/space/people/${id}`, {})).status).toBe(204);
    expect(await people()).toEqual([]);
    expect((await client.request('DELETE', `/space/people/${id}`, {})).status).toBe(404);
  });

  it('stop at the limit, but the ones there can still change', async () => {
    const space = toBase64Url(randomBytes(16));
    const first = newId();
    await client.request('PUT', `/space/people/${first}`, { meta: newMeta() });
    const tag = (sqlite.prepare('SELECT space FROM people').get() as { space: string }).space;
    const insert = sqlite.prepare('INSERT INTO people (space, id, meta) VALUES (?, ?, ?)');
    for (let i = 1; i < MAX_PEOPLE; i++) insert.run(tag, newId(), 'x');
    expect(
      (await client.request('PUT', `/space/people/${newId()}`, { meta: newMeta() })).status,
    ).toBe(409);
    expect(
      (await client.request('PUT', `/space/people/${first}`, { meta: newMeta() })).status,
    ).toBe(204);
    // Other spaces have their own limit.
    useSpace(client, space);
    expect(
      (await client.request('PUT', `/space/people/${newId()}`, { meta: newMeta() })).status,
    ).toBe(204);
  });
});

describe('face data', () => {
  it('is forgotten all at once, giving its storage back', async () => {
    await client.request('PUT', `/space/faces/${newId()}`, { data: segmentData(800) });
    await client.request('PUT', `/space/people/${newId()}`, { meta: newMeta() });
    expect((await client.request('DELETE', '/space/face-data', {})).status).toBe(204);
    expect((await segments()).segments).toEqual([]);
    expect(await people()).toEqual([]);
    expect(stored()).toBe(0);
  });

  it('goes with the rest of the space when the space is wiped', async () => {
    await client.request('PUT', `/space/faces/${newId()}`, { data: segmentData(800) });
    await client.request('PUT', `/space/people/${newId()}`, { meta: newMeta() });
    expect((await client.request('DELETE', '/space', {})).status).toBe(204);
    expect((await segments()).segments).toEqual([]);
    expect(await people()).toEqual([]);
    expect(stored()).toBe(0);
  });

  it('is only for the space’s owner, never a member', async () => {
    for (const access of ['view', 'edit'] as const) {
      const memberToken = toBase64Url(randomBytes(16));
      const member = { id: newId(), token: memberToken, meta: newMeta(), access };
      expect((await client.request('POST', '/space/members', member)).status).toBe(201);
      const guest = await signUp(`kim-${access}@example.com`);
      useSpace(guest, memberToken);
      const id = newId();
      expect((await guest.request('GET', '/space/faces')).status).toBe(403);
      expect(
        (await guest.request('PUT', `/space/faces/${id}`, { data: segmentData() })).status,
      ).toBe(403);
      expect((await guest.request('DELETE', '/space/faces', { ids: [id] })).status).toBe(403);
      expect((await guest.request('DELETE', '/space/face-data', {})).status).toBe(403);
      expect((await guest.request('GET', '/space/people')).status).toBe(403);
      expect((await guest.request('PUT', `/space/people/${id}`, { meta: newMeta() })).status).toBe(
        403,
      );
      expect((await guest.request('DELETE', `/space/people/${id}`, {})).status).toBe(403);
    }
  });
});
