import { randomBytes, toBase64Url } from '@arcafold/crypto/webcrypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { SPACE_HEADER } from '@arcafold/types';
import type { StampResponse } from '@arcafold/types';

import type { Env } from './env';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';
import { createTestR2 } from './test/r2';

const random = (bytes: number) => toBase64Url(randomBytes(bytes));
const newId = () => random(16);
const newMeta = () => random(300);

let env: Env;
let owner: Client;

async function signUp(email: string): Promise<Client> {
  const client = new Client(env);
  const keyring = await makeKeyring([newLoginKey(), newLoginKey(), newLoginKey()]);
  await client.request('POST', '/auth/signup', { email, name: 'Someone', keyring });
  return client;
}

async function stampOf(c: Client): Promise<string> {
  const res = await c.request('GET', '/space/stamp');
  expect(res.status).toBe(200);
  return (await res.json<StampResponse>()).stamp;
}

/** Someone else, signed in, holding `token`. */
async function holder(token: string): Promise<Client> {
  const c = await signUp(`${newId()}@example.com`);
  c.headers = { [SPACE_HEADER]: token };
  return c;
}

async function addAlbum(shared: boolean): Promise<string> {
  const id = newId();
  expect((await owner.request('POST', '/space/albums', { id, meta: newMeta() })).status).toBe(201);
  if (shared) {
    const res = await owner.request('PUT', `/space/albums/${id}/shared`, { meta: newMeta() });
    expect(res.status).toBe(204);
  }
  return id;
}

async function addMember(extra: object): Promise<{ id: string; token: string }> {
  const member = { id: newId(), token: random(16), meta: newMeta(), ...extra };
  expect((await owner.request('POST', '/space/members', member)).status).toBe(201);
  return member;
}

async function upload(): Promise<string> {
  const id = newId();
  const thumb = randomBytes(10);
  const full = randomBytes(20);
  const photo = { id, meta: newMeta(), thumbSize: thumb.length, fullSize: full.length };
  expect((await owner.request('POST', '/space/photos', photo)).status).toBe(201);
  for (const [part, data] of [
    ['thumb', thumb],
    ['full', full],
  ] as const) {
    const res = await owner.send('PUT', `/space/photos/${id}/${part}`, new Uint8Array(data), {
      'content-type': 'application/octet-stream',
      'content-length': String(data.length),
    });
    expect(res.status).toBe(200);
  }
  return id;
}

beforeEach(async () => {
  env = { DB: createTestDb().db, BLOBS: createTestR2().bucket };
  owner = await signUp('sam@example.com');
  owner.headers = { [SPACE_HEADER]: random(16) };
});

describe('the space stamp', () => {
  it('changes when anyone changes the space, and not when they only look', async () => {
    const before = await stampOf(owner);
    const member = await holder((await addMember({ access: 'edit' })).token);
    const shared = await stampOf(owner);
    expect(shared).not.toBe(before);
    expect(await stampOf(member)).toBe(shared);
    await owner.request('GET', '/space/photos');
    await owner.request('GET', '/space/albums');
    expect(await stampOf(owner)).toBe(shared);
    expect(
      (await member.request('POST', '/space/albums', { id: newId(), meta: newMeta() })).status,
    ).toBe(201);
    expect(await stampOf(owner)).not.toBe(shared);
  });

  it('doesn’t change when a change is refused', async () => {
    const viewer = await holder((await addMember({ access: 'view' })).token);
    const before = await stampOf(owner);
    expect(
      (await viewer.request('POST', '/space/albums', { id: newId(), meta: newMeta() })).status,
    ).toBe(403);
    expect(
      (await owner.request('POST', '/space/albums', { id: 'x', meta: newMeta() })).status,
    ).toBe(400);
    expect(await stampOf(owner)).toBe(before);
  });

  it('tells a library member their access changed', async () => {
    const member = await addMember({ access: 'view' });
    const them = await holder(member.token);
    const before = await stampOf(them);
    expect(
      (await owner.request('PUT', `/space/members/${member.id}`, { access: 'edit' })).status,
    ).toBe(204);
    expect(await stampOf(them)).not.toBe(before);
  });

  it('is forgotten when the space is wiped', async () => {
    await addAlbum(false);
    expect(await stampOf(owner)).not.toBe('');
    expect((await owner.request('DELETE', '/space', {})).status).toBe(204);
    expect(await stampOf(owner)).toBe('');
  });

  it('can’t be read with a phone’s upload-only token', async () => {
    const token = random(16);
    expect(
      (await owner.request('POST', '/space/upload-tokens', { id: newId(), token })).status,
    ).toBe(201);
    const phone = new Client(env);
    phone.cookie = owner.cookie;
    phone.headers = { [SPACE_HEADER]: token };
    expect((await phone.request('GET', '/space/stamp')).status).toBe(403);
  });
});

describe('the stamp of one album', () => {
  it('changes with what its people see, and with nothing else in the space', async () => {
    const album = await addAlbum(true);
    const member = await addMember({ album, access: 'view' });
    const them = await holder(member.token);
    const photo = await upload();
    const start = await stampOf(them);

    // The rest of the space changing tells them nothing.
    await addAlbum(true);
    await upload();
    expect((await owner.request('PUT', `/space/photos/${photo}`, { meta: newMeta() })).status).toBe(
      204,
    );
    expect(await stampOf(them)).toBe(start);

    // A photo listed in their album does.
    expect(
      (await owner.request('PUT', `/space/albums/${album}/items/${photo}`, { meta: newMeta() }))
        .status,
    ).toBe(204);
    const listed = await stampOf(them);
    expect(listed).not.toBe(start);

    // So does it changing, going to Recently deleted, the album's own record, or their access.
    expect(
      (await owner.request('PUT', `/space/albums/${album}/items/${photo}`, { meta: newMeta() }))
        .status,
    ).toBe(204);
    const changed = await stampOf(them);
    expect(changed).not.toBe(listed);
    expect(
      (await owner.request('POST', '/space/trash', { photos: [{ id: photo, meta: newMeta() }] }))
        .status,
    ).toBe(200);
    const trashed = await stampOf(them);
    expect(trashed).not.toBe(changed);
    expect(
      (await owner.request('PUT', `/space/albums/${album}/shared`, { meta: newMeta() })).status,
    ).toBe(204);
    const renamed = await stampOf(them);
    expect(renamed).not.toBe(trashed);
    expect(
      (await owner.request('PUT', `/space/members/${member.id}`, { access: 'edit' })).status,
    ).toBe(204);
    expect(await stampOf(them)).not.toBe(renamed);
  });

  it('changes when someone given the folder adds a change to it', async () => {
    const album = await addAlbum(true);
    const editor = await holder((await addMember({ album, access: 'edit' })).token);
    const viewer = await holder((await addMember({ album, access: 'view' })).token);
    const before = await stampOf(viewer);
    const res = await editor.request('POST', `/space/albums/${album}/edits`, {
      id: newId(),
      meta: newMeta(),
    });
    expect(res.status).toBe(201);
    expect(await stampOf(viewer)).not.toBe(before);
  });
});
