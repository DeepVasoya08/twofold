import { randomBytes, toBase64Url } from '@twofold/crypto/webcrypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { SPACE_HEADER } from '@twofold/types';
import type { MemberAccess, MemberList, MembershipResponse, PhotoPage } from '@twofold/types';

import type { Env } from './env';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';
import { createTestR2 } from './test/r2';

let env: Env;
let owner: Client;
let guest: Client;
let mainToken: string;

const random = (bytes: number) => toBase64Url(randomBytes(bytes));
const newId = () => random(16);
const newMeta = () => random(300);

async function signUp(email: string): Promise<Client> {
  const client = new Client(env);
  const keyring = await makeKeyring([newLoginKey(), newLoginKey(), newLoginKey()]);
  await client.request('POST', '/auth/signup', { email, name: 'Someone', keyring });
  return client;
}

function useSpace(c: Client, token: string): void {
  c.headers = { [SPACE_HEADER]: token };
}

beforeEach(async () => {
  const db = createTestDb();
  env = { DB: db.db, BLOBS: createTestR2().bucket };
  owner = await signUp('sam@example.com');
  guest = await signUp('kim@example.com');
  mainToken = random(16);
  useSpace(owner, mainToken);
});

function putFile(c: Client, id: string, part: 'thumb' | 'full', data: Uint8Array) {
  return c.send('PUT', `/space/photos/${id}/${part}`, new Uint8Array(data), {
    'content-type': 'application/octet-stream',
    'content-length': String(data.length),
  });
}

async function upload(c = owner): Promise<string> {
  const thumb = randomBytes(100);
  const full = randomBytes(1000);
  const photo = { id: newId(), meta: newMeta(), thumbSize: thumb.length, fullSize: full.length };
  expect((await c.request('POST', '/space/photos', photo)).status).toBe(201);
  expect((await putFile(c, photo.id, 'thumb', thumb)).status).toBe(200);
  expect((await putFile(c, photo.id, 'full', full)).status).toBe(200);
  expect((await c.request('POST', `/space/photos/${photo.id}/commit`, {})).status).toBe(204);
  return photo.id;
}

async function addAlbum(c = owner): Promise<string> {
  const id = newId();
  expect((await c.request('POST', '/space/albums', { id, meta: newMeta() })).status).toBe(201);
  return id;
}

/** Shares the owner's open space; `access` left out means whatever the server defaults to. */
async function share(access?: MemberAccess): Promise<{ id: string; token: string }> {
  const member = { id: newId(), token: random(16), meta: newMeta(), ...(access && { access }) };
  expect((await owner.request('POST', '/space/members', member)).status).toBe(201);
  return member;
}

async function photoIds(c: Client): Promise<string[]> {
  const res = await c.request('GET', '/space/photos');
  expect(res.status).toBe(200);
  return (await res.json<PhotoPage>()).photos.map((photo) => photo.id);
}

async function accessOf(c: Client): Promise<MemberAccess> {
  const res = await c.request('GET', '/space/membership');
  expect(res.status).toBe(200);
  return (await res.json<MembershipResponse>()).access;
}

async function listed(): Promise<MemberList['members']> {
  return (await (await owner.request('GET', '/space/members')).json<MemberList>()).members;
}

describe('view-only members', () => {
  it('can see and download everything, and change nothing', async () => {
    const photo = await upload();
    const album = await addAlbum();
    const member = await share('view');
    useSpace(guest, member.token);

    expect(await photoIds(guest)).toEqual([photo]);
    expect((await guest.request('GET', `/space/photos/${photo}/full`)).status).toBe(200);
    expect((await guest.request('GET', `/space/thumbs?ids=${photo}`)).status).toBe(200);
    expect((await guest.request('GET', '/space/albums')).status).toBe(200);
    expect(await accessOf(guest)).toBe('view');

    const refused: [string, string, unknown?][] = [
      ['POST', '/space/photos', { id: newId(), meta: newMeta(), thumbSize: 100, fullSize: 100 }],
      ['PUT', `/space/photos/${photo}`, { meta: newMeta() }],
      ['DELETE', `/space/photos/${photo}`, {}],
      ['POST', '/space/albums', { id: newId(), meta: newMeta() }],
      ['PUT', `/space/albums/${album}`, { meta: newMeta() }],
      ['DELETE', `/space/albums/${album}`, {}],
      ['PUT', `/space/albums/${album}/shared`, { meta: newMeta() }],
      ['PUT', `/space/albums/${album}/items/${photo}`, { meta: newMeta() }],
      ['PUT', `/space/members/${member.id}`, { access: 'edit' }],
      ['DELETE', '/space', {}],
    ];
    for (const [method, path, body] of refused) {
      expect((await guest.request(method, path, body)).status, `${method} ${path}`).toBe(403);
    }
    // Owner-only reads stay owner-only.
    expect((await guest.request('GET', '/space/members')).status).toBe(403);
    expect(await photoIds(owner)).toEqual([photo]);
  });

  it('can still leave', async () => {
    const member = await share('view');
    useSpace(guest, member.token);
    expect((await guest.request('DELETE', '/space/membership', {})).status).toBe(204);
    expect(await listed()).toEqual([]);
  });

  it('is what a member gets when the owner doesn’t say', async () => {
    const member = await share();
    useSpace(guest, member.token);
    expect(await accessOf(guest)).toBe('view');
    expect(
      (await guest.request('POST', '/space/albums', { id: newId(), meta: newMeta() })).status,
    ).toBe(403);
  });
});

describe('members who can edit', () => {
  it('can add, change and delete', async () => {
    const member = await share('edit');
    useSpace(guest, member.token);
    expect(await accessOf(guest)).toBe('edit');
    const added = await upload(guest);
    expect((await guest.request('PUT', `/space/photos/${added}`, { meta: newMeta() })).status).toBe(
      204,
    );
    await addAlbum(guest);
    expect((await guest.request('DELETE', `/space/photos/${added}`, {})).status).toBe(204);
  });
});

describe('changing access', () => {
  it('takes effect on the member’s next request', async () => {
    const photo = await upload();
    const member = await share('edit');
    useSpace(guest, member.token);
    expect((await guest.request('PUT', `/space/photos/${photo}`, { meta: newMeta() })).status).toBe(
      204,
    );

    expect(
      (await owner.request('PUT', `/space/members/${member.id}`, { access: 'view' })).status,
    ).toBe(204);
    expect(await accessOf(guest)).toBe('view');
    expect((await guest.request('PUT', `/space/photos/${photo}`, { meta: newMeta() })).status).toBe(
      403,
    );
    expect(await listed()).toEqual([
      { id: member.id, meta: expect.any(String) as string, album: null, access: 'view' },
    ]);

    expect(
      (await owner.request('PUT', `/space/members/${member.id}`, { access: 'edit' })).status,
    ).toBe(204);
    expect((await guest.request('PUT', `/space/photos/${photo}`, { meta: newMeta() })).status).toBe(
      204,
    );
  });

  it('refuses unknown members, other spaces’ members, album members and bad values', async () => {
    const member = await share('view');
    expect(
      (await owner.request('PUT', `/space/members/${newId()}`, { access: 'edit' })).status,
    ).toBe(404);
    expect(
      (await owner.request('PUT', `/space/members/${member.id}`, { access: 'all' })).status,
    ).toBe(400);
    expect((await owner.request('PUT', `/space/members/${member.id}`, {})).status).toBe(400);

    // Someone given one album can only ever view it.
    const album = await addAlbum();
    expect(
      (await owner.request('PUT', `/space/albums/${album}/shared`, { meta: newMeta() })).status,
    ).toBe(204);
    const albumMember = { id: newId(), token: random(16), meta: newMeta(), album, access: 'edit' };
    expect((await owner.request('POST', '/space/members', albumMember)).status).toBe(201);
    expect(
      (await owner.request('PUT', `/space/members/${albumMember.id}`, { access: 'edit' })).status,
    ).toBe(404);
    useSpace(guest, albumMember.token);
    expect(await accessOf(guest)).toBe('view');

    // Another space can't change this space's members.
    useSpace(owner, random(16));
    expect(
      (await owner.request('PUT', `/space/members/${member.id}`, { access: 'edit' })).status,
    ).toBe(404);
  });
});

describe('the space’s own token', () => {
  it('has no membership', async () => {
    expect((await owner.request('GET', '/space/membership')).status).toBe(400);
  });
});

describe('sharing the main library', () => {
  it('never reaches photos or albums in another space of the same account', async () => {
    const mainPhoto = await upload();
    const member = await share('edit');
    // The same account opens its private space: a space with a token of its own.
    useSpace(owner, random(16));
    const privatePhoto = await upload();
    await addAlbum();

    useSpace(guest, member.token);
    expect(await photoIds(guest)).toEqual([mainPhoto]);
    expect((await guest.request('GET', `/space/photos/${privatePhoto}/full`)).status).toBe(404);
    const albums = await guest.request('GET', '/space/albums');
    expect((await albums.json<{ albums: unknown[] }>()).albums).toEqual([]);
    // What the member adds lands in the main library, never the private one.
    const added = await upload(guest);
    useSpace(owner, mainToken);
    expect((await photoIds(owner)).sort()).toEqual([mainPhoto, added].sort());
  });
});
