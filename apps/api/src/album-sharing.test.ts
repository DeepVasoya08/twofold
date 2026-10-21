import { randomBytes, toBase64Url } from '@twofold/crypto/webcrypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { MAX_ALBUM_MEMBERS, SPACE_HEADER, readThumbBatch } from '@twofold/types';
import type { AlbumItemList, AlbumList, MemberList, PhotoPage } from '@twofold/types';

import type { Env } from './env';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';
import { createTestR2 } from './test/r2';

let env: Env;
let owner: Client;
let guest: Client;

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
  useSpace(owner, random(16));
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

async function shareAlbum(album: string, c = owner): Promise<void> {
  expect(
    (await c.request('PUT', `/space/albums/${album}/shared`, { meta: newMeta() })).status,
  ).toBe(204);
}

async function putItem(album: string, photo: string, meta = newMeta(), c = owner) {
  return c.request('PUT', `/space/albums/${album}/items/${photo}`, { meta });
}

/** Gives someone the album: a member row scoped to it, with their own token. */
async function addAlbumMember(album: string): Promise<{ id: string; token: string }> {
  const member = { id: newId(), token: random(16), meta: newMeta(), album };
  expect((await owner.request('POST', '/space/members', member)).status).toBe(201);
  return member;
}

async function photoIds(c: Client): Promise<string[]> {
  const res = await c.request('GET', '/space/photos');
  expect(res.status).toBe(200);
  return (await res.json<PhotoPage>()).photos.map((photo) => photo.id);
}

async function itemIds(album: string, c = owner): Promise<string[]> {
  const res = await c.request('GET', `/space/albums/${album}/items`);
  expect(res.status).toBe(200);
  return (await res.json<AlbumItemList>()).photoIds;
}

describe('sharing an album', () => {
  it('shows someone only that album and the photos listed in it, with the album’s records', async () => {
    const album = await addAlbum();
    await addAlbum();
    const inAlbum = await upload();
    await upload();
    await shareAlbum(album);
    const itemMeta = newMeta();
    expect((await putItem(album, inAlbum, itemMeta)).status).toBe(204);
    const member = await addAlbumMember(album);

    useSpace(guest, member.token);
    const photos = await guest.request('GET', '/space/photos');
    const page = await photos.json<PhotoPage>();
    // The album's sealed copy of the photo's details, never the space's own record.
    expect(page.photos).toEqual([{ id: inAlbum, meta: itemMeta, thumbSize: 100, fullSize: 1000 }]);
    const albums = await (await guest.request('GET', '/space/albums')).json<AlbumList>();
    expect(albums.albums.map((a) => a.id)).toEqual([album]);
  });

  it('serves files only for photos the album lists', async () => {
    const album = await addAlbum();
    const listed = await upload();
    const other = await upload();
    await shareAlbum(album);
    await putItem(album, listed);
    const member = await addAlbumMember(album);
    useSpace(guest, member.token);

    expect((await guest.request('GET', `/space/photos/${listed}/full`)).status).toBe(200);
    expect((await guest.request('GET', `/space/photos/${other}/full`)).status).toBe(404);
    expect((await guest.request('GET', `/space/photos/${other}/thumb`)).status).toBe(404);
    const batch = await guest.request('GET', `/space/thumbs?ids=${listed},${other}`);
    const parts = readThumbBatch(new Uint8Array(await batch.arrayBuffer()), 2);
    expect(parts?.[0]).not.toBeNull();
    expect(parts?.[1]).toBeNull();
  });

  it('can’t change anything or reach the rest of the library', async () => {
    const album = await addAlbum();
    const photo = await upload();
    await shareAlbum(album);
    await putItem(album, photo);
    const member = await addAlbumMember(album);
    useSpace(guest, member.token);

    const refused: [string, string, unknown?][] = [
      ['POST', '/space/photos', { id: newId(), meta: newMeta(), thumbSize: 100, fullSize: 100 }],
      ['PUT', `/space/photos/${photo}`, { meta: newMeta() }],
      ['DELETE', `/space/photos/${photo}`, {}],
      ['POST', '/space/albums', { id: newId(), meta: newMeta() }],
      ['PUT', `/space/albums/${album}`, { meta: newMeta() }],
      ['DELETE', `/space/albums/${album}`, {}],
      ['PUT', `/space/albums/${album}/shared`, { meta: newMeta() }],
      ['GET', `/space/albums/${album}/items`],
      ['PUT', `/space/albums/${album}/items/${photo}`, { meta: newMeta() }],
      ['DELETE', `/space/albums/${album}/items/${photo}`, {}],
      ['GET', '/space/members'],
      ['GET', '/space/joined'],
      ['DELETE', '/space', {}],
    ];
    for (const [method, path, body] of refused) {
      expect((await guest.request(method, path, body)).status, `${method} ${path}`).toBe(403);
    }
    expect(await photoIds(owner)).toEqual([photo]);
  });

  it('follows photos into and out of the album, and photo deletes', async () => {
    const album = await addAlbum();
    const first = await upload();
    const second = await upload();
    await shareAlbum(album);
    await putItem(album, first);
    await putItem(album, second);
    const member = await addAlbumMember(album);
    useSpace(guest, member.token);
    expect((await photoIds(guest)).sort()).toEqual([first, second].sort());

    expect(
      (await owner.request('DELETE', `/space/albums/${album}/items/${first}`, {})).status,
    ).toBe(204);
    expect(await photoIds(guest)).toEqual([second]);
    expect((await owner.request('DELETE', `/space/photos/${second}`, {})).status).toBe(204);
    expect(await photoIds(guest)).toEqual([]);
    expect(await itemIds(album)).toEqual([]);
  });

  it('only lists committed photos of the same space, and only in a shared album', async () => {
    const album = await addAlbum();
    const photo = await upload();
    // Not shared yet.
    expect((await putItem(album, photo)).status).toBe(404);
    await shareAlbum(album);
    // Another space's photo, and a photo that doesn't exist.
    const elsewhere = new Client(env);
    elsewhere.cookie = owner.cookie;
    useSpace(elsewhere, random(16));
    const foreign = await upload(elsewhere);
    expect((await putItem(album, foreign)).status).toBe(404);
    expect((await putItem(album, newId())).status).toBe(404);
    // Someone else's space can't list into this album either.
    expect((await putItem(album, foreign, newMeta(), elsewhere)).status).toBe(404);
    expect((await putItem(album, photo)).status).toBe(204);
    // Replacing the details keeps one item.
    expect((await putItem(album, photo)).status).toBe(204);
    expect(await itemIds(album)).toEqual([photo]);
  });

  it('needs the album to be shared before anyone gets it', async () => {
    const album = await addAlbum();
    const member = { id: newId(), token: random(16), meta: newMeta(), album };
    expect((await owner.request('POST', '/space/members', member)).status).toBe(404);
    await shareAlbum(album);
    expect((await owner.request('POST', '/space/members', member)).status).toBe(201);
    const listed = await (await owner.request('GET', '/space/members')).json<MemberList>();
    expect(listed.members).toEqual([{ id: member.id, meta: member.meta, album }]);
  });

  it('limits how many people one album is shared with, apart from the library', async () => {
    const album = await addAlbum();
    await shareAlbum(album);
    for (let i = 0; i < MAX_ALBUM_MEMBERS; i++) await addAlbumMember(album);
    const one = { id: newId(), token: random(16), meta: newMeta(), album };
    expect((await owner.request('POST', '/space/members', one)).status).toBe(409);
    // Library sharing has its own limit.
    const library = { id: newId(), token: random(16), meta: newMeta() };
    expect((await owner.request('POST', '/space/members', library)).status).toBe(201);
  });

  it('stops for everyone when sharing stops or the album is deleted', async () => {
    const album = await addAlbum();
    const photo = await upload();
    await shareAlbum(album);
    await putItem(album, photo);
    const member = await addAlbumMember(album);
    expect((await owner.request('DELETE', `/space/albums/${album}/shared`, {})).status).toBe(204);
    useSpace(guest, member.token);
    // The token is gone, so it names an empty space of its own.
    expect(await photoIds(guest)).toEqual([]);
    expect(await itemIds(album)).toEqual([]);

    await shareAlbum(album);
    await putItem(album, photo);
    const again = await addAlbumMember(album);
    expect((await owner.request('DELETE', `/space/albums/${album}`, {})).status).toBe(204);
    useSpace(guest, again.token);
    expect(await photoIds(guest)).toEqual([]);
    const members = await (await owner.request('GET', '/space/members')).json<MemberList>();
    expect(members.members).toEqual([]);
  });

  it('lets someone leave, and the owner remove them', async () => {
    const album = await addAlbum();
    const photo = await upload();
    await shareAlbum(album);
    await putItem(album, photo);
    const leaving = await addAlbumMember(album);
    const removed = await addAlbumMember(album);
    useSpace(guest, leaving.token);
    expect((await guest.request('DELETE', '/space/membership', {})).status).toBe(204);
    expect(await photoIds(guest)).toEqual([]);
    expect((await owner.request('DELETE', `/space/members/${removed.id}`, {})).status).toBe(204);
    useSpace(guest, removed.token);
    expect(await photoIds(guest)).toEqual([]);
  });

  it('lets library members keep a shared album’s items up to date, but not stop sharing', async () => {
    const album = await addAlbum();
    await shareAlbum(album);
    const libraryMember = { id: newId(), token: random(16), meta: newMeta() };
    expect((await owner.request('POST', '/space/members', libraryMember)).status).toBe(201);
    useSpace(guest, libraryMember.token);
    const added = await upload(guest);
    expect((await putItem(album, added, newMeta(), guest)).status).toBe(204);
    expect(await itemIds(album)).toEqual([added]);
    expect((await guest.request('DELETE', `/space/albums/${album}/shared`, {})).status).toBe(403);
  });
});
