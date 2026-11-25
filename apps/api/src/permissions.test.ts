import { randomBytes, toBase64Url } from '@arcafold/crypto/webcrypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { SPACE_HEADER } from '@arcafold/types';

import { app } from './app';
import type { Env } from './env';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';
import { createTestR2 } from './test/r2';

/**
 * Every space route, and who may call it. The server is the only judge of this: whatever a
 * device shows or sends, a token gets a 403 for anything its kind of access doesn't allow.
 * A new route fails the inventory test below until it is given a row here.
 */
type Who = 'owner' | 'libraryEdit' | 'libraryView' | 'albumEdit' | 'albumView' | 'upload';

const OWNER: readonly Who[] = ['owner'];
const LIBRARY_EDIT: readonly Who[] = ['owner', 'libraryEdit'];
const LIBRARY_READ: readonly Who[] = ['owner', 'libraryEdit', 'libraryView'];
const ALBUM_READ: readonly Who[] = [...LIBRARY_READ, 'albumEdit', 'albumView'];
const ALBUM_EDIT: readonly Who[] = [...LIBRARY_EDIT, 'albumEdit'];
const UPLOADS: readonly Who[] = [...ALBUM_EDIT, 'upload'];

const RULES: Record<string, readonly Who[]> = {
  'GET /space/photos': ALBUM_READ,
  'POST /space/photos': UPLOADS,
  'GET /space/thumbs': ALBUM_READ,
  'GET /space/photos/:id/:part': ALBUM_READ,
  'PUT /space/photos/:id/:part': UPLOADS,
  'POST /space/photos/:id/commit': UPLOADS,
  'PUT /space/photos/:id': LIBRARY_EDIT,
  'DELETE /space/photos/:id': ALBUM_EDIT,
  'GET /space/trash': LIBRARY_EDIT,
  'POST /space/trash': LIBRARY_EDIT,
  'POST /space/trash/restore': LIBRARY_EDIT,
  'GET /space/albums': ALBUM_READ,
  'POST /space/albums': LIBRARY_EDIT,
  'PUT /space/albums/:id': LIBRARY_EDIT,
  'DELETE /space/albums/:id': LIBRARY_EDIT,
  'PUT /space/albums/:id/shared': LIBRARY_EDIT,
  'DELETE /space/albums/:id/shared': OWNER,
  'GET /space/albums/:id/items': LIBRARY_READ,
  'PUT /space/albums/:id/items/:photo': ALBUM_EDIT,
  'DELETE /space/albums/:id/items/:photo': ALBUM_EDIT,
  'POST /space/albums/:id/edits': ['albumEdit'],
  'DELETE /space/albums/:id/edits/:edit': LIBRARY_EDIT,
  'DELETE /space/albums/:id/removed/:photo': LIBRARY_EDIT,
  'GET /space/upload-key': OWNER,
  'PUT /space/upload-key': OWNER,
  'GET /space/upload-tokens': OWNER,
  'POST /space/upload-tokens': OWNER,
  'DELETE /space/upload-tokens/:id': OWNER,
  'GET /space/profile-photo': OWNER,
  'PUT /space/profile-photo': OWNER,
  'DELETE /space/profile-photo': OWNER,
  'GET /space/members': OWNER,
  'POST /space/members': OWNER,
  'PUT /space/members/:id': OWNER,
  'DELETE /space/members/:id': OWNER,
  'GET /space/membership': ['libraryEdit', 'libraryView', 'albumEdit', 'albumView'],
  'GET /space/joined': OWNER,
  'POST /space/joined': OWNER,
  'DELETE /space/joined/:id': OWNER,
  'GET /space/pending-invites': OWNER,
  'POST /space/pending-invites': OWNER,
  'PUT /space/pending-invites/:id': OWNER,
  'DELETE /space/pending-invites/:id': OWNER,
  'GET /space/faces': OWNER,
  'PUT /space/faces/:id': OWNER,
  'DELETE /space/faces': OWNER,
  'DELETE /space/face-data': OWNER,
  'GET /space/people': OWNER,
  'PUT /space/people/:id': OWNER,
  'DELETE /space/people/:id': OWNER,
  'GET /space/search': OWNER,
  'PUT /space/search/:id': OWNER,
  'DELETE /space/search': OWNER,
  'DELETE /space/search-data': OWNER,
  'GET /space/words': OWNER,
  'PUT /space/words/:id': OWNER,
  'DELETE /space/words/:id': OWNER,
  'GET /space/smart-albums': OWNER,
  'PUT /space/smart-albums/:id': OWNER,
  'DELETE /space/smart-albums/:id': OWNER,
  // These end the token or the space, so they run last.
  'DELETE /space': OWNER,
  'DELETE /space/membership': ['libraryEdit', 'libraryView', 'albumEdit', 'albumView'],
};

/** Calls that can only fail for the owner because the owner's token isn't a membership. */
const NOT_A_MEMBERSHIP = new Set(['GET /space/membership', 'DELETE /space/membership']);

const random = (bytes: number) => toBase64Url(randomBytes(bytes));
const newId = () => random(16);

let env: Env;
let owner: Client;
let album: string;
const tokens = new Map<Who, string>();

beforeEach(async () => {
  env = { DB: createTestDb().db, BLOBS: createTestR2().bucket };
  owner = new Client(env);
  const keyring = await makeKeyring([newLoginKey(), newLoginKey(), newLoginKey()]);
  await owner.request('POST', '/auth/signup', { email: 'sam@example.com', name: 'Sam', keyring });
  tokens.clear();
  tokens.set('owner', random(16));
  owner.headers = { [SPACE_HEADER]: tokens.get('owner') ?? '' };
  album = newId();
  const meta = random(300);
  expect((await owner.request('POST', '/space/albums', { id: album, meta })).status).toBe(201);
  expect((await owner.request('PUT', `/space/albums/${album}/shared`, { meta })).status).toBe(204);
  const members: [Who, object][] = [
    ['libraryEdit', { access: 'edit' }],
    ['libraryView', { access: 'view' }],
    ['albumEdit', { access: 'edit', album }],
    ['albumView', { access: 'view', album }],
  ];
  for (const [who, extra] of members) {
    const token = random(16);
    const member = { id: newId(), token, meta: random(300), ...extra };
    expect((await owner.request('POST', '/space/members', member)).status).toBe(201);
    tokens.set(who, token);
  }
  const upload = random(16);
  const added = await owner.request('POST', '/space/upload-tokens', { id: newId(), token: upload });
  expect(added.status).toBe(201);
  tokens.set('upload', upload);
});

/** The route with its parameters filled in: a token's own album, random ids otherwise. */
function fill(path: string): string {
  return path
    .replace(/^\/space\/albums\/:id/, `/space/albums/${album}`)
    .replace(':part', 'thumb')
    .replace(/:[a-z]+/g, () => newId());
}

describe('who may call each route', () => {
  it('has a rule for every space route', () => {
    const routes = new Set(
      app.routes
        .filter((route) => route.method !== 'ALL' && route.path.startsWith('/api/space'))
        .map((route) => `${route.method} ${route.path.replace(/^\/api/, '')}`),
    );
    expect([...routes].sort()).toEqual(Object.keys(RULES).sort());
  });

  const everyone: Who[] = [
    'owner',
    'libraryEdit',
    'libraryView',
    'albumEdit',
    'albumView',
    'upload',
  ];
  for (const who of everyone) {
    it(`refuses ${who} everything it may not do, and lets it through the rest`, async () => {
      const client = new Client(env);
      client.cookie = owner.cookie;
      client.headers = { [SPACE_HEADER]: tokens.get(who) ?? '' };
      const wrong: string[] = [];
      for (const [route, allowed] of Object.entries(RULES)) {
        const [method = '', path = ''] = route.split(' ');
        const res =
          method === 'GET'
            ? await client.request(method, fill(path))
            : await client.request(method, fill(path), {});
        const refused = res.status === 403;
        const may = allowed.includes(who) || (who === 'owner' && NOT_A_MEMBERSHIP.has(route));
        if (refused === may) wrong.push(`${route} -> ${String(res.status)}`);
        if (res.status === 401) wrong.push(`${route} signed out`);
      }
      expect(wrong).toEqual([]);
    });
  }
});
