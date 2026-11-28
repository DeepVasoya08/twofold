/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { randomBytes, toBase64Url } from '@arcafold/crypto/webcrypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { SPACE_HEADER, readThumbBatch } from '@arcafold/types';
import type { AlbumList, PhotoPage } from '@arcafold/types';

import type { Env } from './env';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';
import { createTestR2 } from './test/r2';
import type { TestR2 } from './test/r2';

/**
 * Record ids are unique within their space only (migrations/0029_per_space_ids.sql), so no
 * request can find out that another space uses an id, and each space's photos keep their
 * own files.
 */

let env: Env;
let r2: TestR2;
let alpha: Client;
let bravo: Client;

const random = (bytes: number) => toBase64Url(randomBytes(bytes));
const newId = () => random(16);
const newMeta = () => random(300);

async function signUp(email: string): Promise<Client> {
  const client = new Client(env);
  const keyring = await makeKeyring([newLoginKey(), newLoginKey(), newLoginKey()]);
  await client.request('POST', '/auth/signup', { email, name: 'Someone', keyring });
  return client;
}

function useSpace(c: Client, token: string): Client {
  c.headers = { [SPACE_HEADER]: token };
  return c;
}

beforeEach(async () => {
  const db = createTestDb();
  const blobs = createTestR2();
  r2 = blobs.r2;
  env = { DB: db.db, BLOBS: blobs.bucket };
  alpha = useSpace(await signUp('alpha@example.com'), random(16));
  bravo = useSpace(await signUp('bravo@example.com'), random(16));
});

function putFile(c: Client, id: string, part: 'thumb' | 'full', data: Uint8Array) {
  return c.send('PUT', `/space/photos/${id}/${part}`, new Uint8Array(data), {
    'content-type': 'application/octet-stream',
    'content-length': String(data.length),
  });
}

/** Uploads a photo with this id and random files, and returns the files. */
async function upload(c: Client, id: string): Promise<{ thumb: Uint8Array; full: Uint8Array }> {
  const thumb = randomBytes(100);
  const full = randomBytes(1000);
  const photo = { id, meta: newMeta(), thumbSize: thumb.length, fullSize: full.length };
  expect((await c.request('POST', '/space/photos', photo)).status).toBe(201);
  expect((await putFile(c, id, 'thumb', thumb)).status).toBe(200);
  expect(await (await putFile(c, id, 'full', full)).json()).toEqual({ committed: true });
  return { thumb, full };
}

async function download(c: Client, id: string, part: 'thumb' | 'full'): Promise<Uint8Array> {
  const res = await c.request('GET', `/space/photos/${id}/${part}`);
  expect(res.status).toBe(200);
  return new Uint8Array(await res.arrayBuffer());
}

async function thumbBatch(c: Client, ids: string[]): Promise<(Uint8Array | null)[] | null> {
  const res = await c.request('GET', `/space/thumbs?ids=${ids.join(',')}`);
  expect(res.status).toBe(200);
  return readThumbBatch(new Uint8Array(await res.arrayBuffer()), ids.length);
}

describe('the same id in two spaces', () => {
  it('gives each space its own photo and files, and deleting one leaves the other', async () => {
    const id = newId();
    const alphas = await upload(alpha, id);
    const bravos = await upload(bravo, id);
    expect(r2.objects.size).toBe(4);

    expect(await download(alpha, id, 'full')).toEqual(alphas.full);
    expect(await download(bravo, id, 'full')).toEqual(bravos.full);
    expect(await thumbBatch(alpha, [id])).toEqual([alphas.thumb]);
    expect(await thumbBatch(bravo, [id])).toEqual([bravos.thumb]);

    expect((await bravo.request('DELETE', `/space/photos/${id}`, {})).status).toBe(204);
    expect((await bravo.request('GET', `/space/photos/${id}/full`)).status).toBe(404);
    expect(await download(alpha, id, 'full')).toEqual(alphas.full);
    expect(r2.objects.size).toBe(2);
  });

  it('never overwrites another space’s files, whatever an upload names', async () => {
    const id = newId();
    const alphas = await upload(alpha, id);
    // Bravo starts an upload with the same id and sends both files, which land under a new
    // name of its own.
    const photo = { id, meta: newMeta(), thumbSize: 100, fullSize: 1000 };
    expect((await bravo.request('POST', '/space/photos', photo)).status).toBe(201);
    await putFile(bravo, id, 'thumb', randomBytes(100));
    await putFile(bravo, id, 'full', randomBytes(1000));
    expect(await download(alpha, id, 'thumb')).toEqual(alphas.thumb);
    expect(await download(alpha, id, 'full')).toEqual(alphas.full);
  });

  it('answers an id another space uses as it would a new one, and refuses only its own', async () => {
    // From the same account's other space too: the main library learns nothing about a
    // private space's ids.
    const otherSpace = useSpace(new Client(env), random(16));
    otherSpace.cookie = alpha.cookie;
    const id = newId();
    const creates: [string, () => unknown][] = [
      ['/space/photos', () => ({ id, meta: newMeta(), thumbSize: 10, fullSize: 20 })],
      ['/space/albums', () => ({ id, meta: newMeta() })],
      ['/space/joined', () => ({ id, meta: newMeta() })],
      ['/space/pending-invites', () => ({ id, meta: newMeta() })],
      ['/space/members', () => ({ id, token: random(16), meta: newMeta() })],
      ['/space/upload-tokens', () => ({ id, token: random(16) })],
    ];
    for (const [path, body] of creates) {
      expect((await alpha.request('POST', path, body())).status).toBe(201);
      for (const other of [otherSpace, bravo]) {
        expect((await other.request('POST', path, body())).status).toBe(201);
      }
      expect((await bravo.request('POST', path, body())).status).toBe(409);
    }
  });

  it('keeps an album shared from one space to that space, whatever ids another uses', async () => {
    const albumId = newId();
    const photoId = newId();
    const owners = [alpha, bravo];
    const files: { thumb: Uint8Array; full: Uint8Array }[] = [];
    for (const owner of owners) {
      expect(
        (await owner.request('POST', '/space/albums', { id: albumId, meta: newMeta() })).status,
      ).toBe(201);
      files.push(await upload(owner, photoId));
      expect(
        (await owner.request('PUT', `/space/albums/${albumId}/shared`, { meta: newMeta() })).status,
      ).toBe(204);
      expect(
        (
          await owner.request('PUT', `/space/albums/${albumId}/items/${photoId}`, {
            meta: newMeta(),
          })
        ).status,
      ).toBe(204);
    }
    const member = { id: newId(), token: random(16), meta: newMeta(), album: albumId };
    expect((await alpha.request('POST', '/space/members', member)).status).toBe(201);
    const guest = useSpace(await signUp('guest@example.com'), member.token);
    const sees = async () => {
      const albums = await (await guest.request('GET', '/space/albums')).json<AlbumList>();
      const photos = await (await guest.request('GET', '/space/photos')).json<PhotoPage>();
      return { albums: albums.albums.length, photos: photos.photos.map((photo) => photo.id) };
    };
    expect(await sees()).toEqual({ albums: 1, photos: [photoId] });
    expect(await download(guest, photoId, 'full')).toEqual(files[0]?.full);

    // Bravo stopping sharing its album of the same id doesn't touch Alpha's.
    expect((await bravo.request('DELETE', `/space/albums/${albumId}/shared`, {})).status).toBe(204);
    expect((await bravo.request('DELETE', `/space/albums/${albumId}`, {})).status).toBe(204);
    expect(await sees()).toEqual({ albums: 1, photos: [photoId] });
    expect(await download(guest, photoId, 'full')).toEqual(files[0]?.full);
  });

  it('keeps changes waiting in a shared folder to its own space', async () => {
    const folderId = newId();
    const editId = newId();
    const editors: Client[] = [];
    for (const [index, owner] of [alpha, bravo].entries()) {
      await owner.request('POST', '/space/albums', { id: folderId, meta: newMeta() });
      await owner.request('PUT', `/space/albums/${folderId}/shared`, { meta: newMeta() });
      const member = {
        id: newId(),
        token: random(16),
        meta: newMeta(),
        album: folderId,
        access: 'edit',
      };
      expect((await owner.request('POST', '/space/members', member)).status).toBe(201);
      editors.push(useSpace(await signUp(`editor${String(index)}@example.com`), member.token));
    }
    for (const editor of editors) {
      const edit = { id: editId, meta: newMeta() };
      expect((await editor.request('POST', `/space/albums/${folderId}/edits`, edit)).status).toBe(
        201,
      );
    }
    const edits = async (owner: Client) => {
      const { albums } = await (await owner.request('GET', '/space/albums')).json<AlbumList>();
      return albums.find((album) => album.id === folderId)?.edits?.map((edit) => edit.id);
    };
    expect(await edits(alpha)).toEqual([editId]);
    expect(
      (await bravo.request('DELETE', `/space/albums/${folderId}/edits/${editId}`, {})).status,
    ).toBe(204);
    expect(await edits(bravo)).toBeUndefined();
    expect(await edits(alpha)).toEqual([editId]);
  });
});

describe('the migration to ids per space', () => {
  const dir = join(import.meta.dirname, '../migrations');
  const migrations = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const apply = (db: DatabaseSync, names: string[]) => {
    for (const name of names) db.exec(readFileSync(join(dir, name), 'utf8'));
  };

  it('keeps every row, and the files of photos from before under their id', () => {
    const db = new DatabaseSync(':memory:');
    apply(
      db,
      migrations.filter((name) => name < '0029'),
    );
    db.exec(`
      INSERT INTO photos (id, space, meta, thumb_size, full_size, trashed) VALUES ('p1', 's1', 'm', 1, 2, 1);
      INSERT INTO albums (id, space, meta, shared_meta) VALUES ('a1', 's1', 'm', 'shared');
      INSERT INTO album_items (album, photo, space, meta) VALUES ('a1', 'p1', 's1', 'm');
      INSERT INTO album_removed (album, photo, space) VALUES ('a1', 'p0', 's1');
      INSERT INTO folder_edits (id, album, space, meta) VALUES ('e1', 'a1', 's1', 'm');
      INSERT INTO folder_edits (id, album, space, meta) VALUES ('e2', 'a1', 's1', 'm');
      INSERT INTO joined (id, space, meta) VALUES ('j1', 's1', 'm');
      INSERT INTO members (id, token_hash, space, meta, album, access) VALUES ('m1', 'h1', 's1', 'm', 'a1', 'view');
      INSERT INTO pending_invites (id, space, meta) VALUES ('i1', 's1', 'm');
      INSERT INTO upload_tokens (id, token_hash, space) VALUES ('u1', 'h2', 's1');
    `);
    apply(
      db,
      migrations.filter((name) => name >= '0029'),
    );

    expect(db.prepare('SELECT id, space, blob, trashed FROM photos').all()).toEqual([
      { id: 'p1', space: 's1', blob: 'p1', trashed: 1 },
    ]);
    expect(db.prepare('SELECT shared_meta FROM albums').all()).toEqual([{ shared_meta: 'shared' }]);
    expect(db.prepare('SELECT access FROM members').all()).toEqual([{ access: 'view' }]);
    for (const table of [
      'album_items',
      'album_removed',
      'joined',
      'pending_invites',
      'upload_tokens',
    ]) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 1 });
    }
    // Waiting changes keep their order, and new ones come after them.
    db.exec("INSERT INTO folder_edits (id, album, space, meta) VALUES ('e3', 'a1', 's1', 'm')");
    expect(db.prepare('SELECT id FROM folder_edits ORDER BY seq').all()).toEqual([
      { id: 'e1' },
      { id: 'e2' },
      { id: 'e3' },
    ]);

    // The same ids now work in another space, and only there.
    db.exec(`
      INSERT INTO photos (id, space, meta, thumb_size, full_size, blob) VALUES ('p1', 's2', 'm', 1, 2, 'b2');
      INSERT INTO albums (id, space, meta) VALUES ('a1', 's2', 'm');
      INSERT INTO album_items (album, photo, space, meta) VALUES ('a1', 'p1', 's2', 'm');
      INSERT INTO folder_edits (id, album, space, meta) VALUES ('e1', 'a1', 's2', 'm');
      INSERT INTO members (id, token_hash, space, meta) VALUES ('m1', 'h3', 's2', 'm');
    `);
    const again = [
      "INSERT INTO photos (id, space, meta, thumb_size, full_size, blob) VALUES ('p1', 's1', 'm', 1, 2, 'b3')",
      // Two rows never share a file, nor two spaces a share token.
      "INSERT INTO photos (id, space, meta, thumb_size, full_size, blob) VALUES ('p9', 's3', 'm', 1, 2, 'b2')",
      "INSERT INTO members (id, token_hash, space, meta) VALUES ('m9', 'h1', 's3', 'm')",
      "INSERT INTO upload_tokens (id, token_hash, space) VALUES ('u9', 'h2', 's3')",
    ];
    for (const sql of again) {
      expect(() => {
        db.exec(sql);
      }).toThrow(/UNIQUE/);
    }
  });
});
