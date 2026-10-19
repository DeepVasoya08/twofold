import { randomBytes, toBase64Url } from '@twofold/crypto/webcrypto';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import { INVITE_TTL_MS, MAX_MEMBERS, SPACE_HEADER } from '@twofold/types';
import type { InviterView, JoinedList, JoinerView, MemberList, PhotoPage } from '@twofold/types';

import type { Env } from './env';
import { MAX_FAILURES } from './proof';
import { createTestDb } from './test/d1';
import { Client, makeKeyring, newLoginKey } from './test/fixtures';
import { createTestR2 } from './test/r2';

let env: Env;
let sqlite: DatabaseSync;
let owner: Client;
let guest: Client;
let ownerToken: string;

const random = (bytes: number) => toBase64Url(randomBytes(bytes));
const newId = () => random(16);
const newMeta = () => random(300);
const newCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = () => alphabet[Math.floor(Math.random() * alphabet.length)] ?? 'A';
  const part = () => Array.from({ length: 4 }, pick).join('');
  return `TWO-${part()}-${part()}`;
};

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
  sqlite = db.sqlite;
  env = { DB: db.db, BLOBS: createTestR2().bucket };
  owner = await signUp('sam@example.com');
  guest = await signUp('kim@example.com');
  ownerToken = random(16);
  useSpace(owner, ownerToken);
});

/** Shares the owner's space and returns the member's token and id. */
async function share(): Promise<{ token: string; id: string }> {
  const member = { id: newId(), token: random(16), meta: newMeta() };
  expect((await owner.request('POST', '/space/members', member)).status).toBe(201);
  return member;
}

async function photoIds(c: Client): Promise<string[]> {
  const res = await c.request('GET', '/space/photos');
  expect(res.status).toBe(200);
  return (await res.json<PhotoPage>()).photos.map((photo) => photo.id);
}

async function addAlbum(c: Client): Promise<string> {
  const id = newId();
  expect((await c.request('POST', '/space/albums', { id, meta: newMeta() })).status).toBe(201);
  return id;
}

describe('members', () => {
  it('reach the owner’s photos and albums with their own token', async () => {
    const albumId = await addAlbum(owner);
    const member = await share();
    useSpace(guest, member.token);
    const res = await guest.request('GET', '/space/albums');
    expect((await res.json<{ albums: { id: string }[] }>()).albums.map((a) => a.id)).toEqual([
      albumId,
    ]);
    // What a member adds lands in the owner's space.
    const added = await addAlbum(guest);
    const ownerAlbums = await owner.request('GET', '/space/albums');
    expect((await ownerAlbums.json<{ albums: unknown[] }>()).albums).toHaveLength(2);
    expect(added).toBeTruthy();
  });

  it('can’t use the owner-only routes', async () => {
    const member = await share();
    useSpace(guest, member.token);
    expect((await guest.request('GET', '/space/members')).status).toBe(403);
    expect(
      (
        await guest.request('POST', '/space/members', {
          id: newId(),
          token: random(16),
          meta: newMeta(),
        })
      ).status,
    ).toBe(403);
    expect((await guest.request('DELETE', `/space/members/${member.id}`, {})).status).toBe(403);
    expect((await guest.request('GET', '/space/joined')).status).toBe(403);
    expect(
      (await guest.request('POST', '/space/joined', { id: newId(), meta: newMeta() })).status,
    ).toBe(403);
    expect((await guest.request('DELETE', '/space', {})).status).toBe(403);
  });

  it('lose access the moment the owner stops sharing, and nobody else does', async () => {
    const first = await share();
    const second = await share();
    await addAlbum(owner);
    expect((await owner.request('DELETE', `/space/members/${first.id}`, {})).status).toBe(204);
    useSpace(guest, first.token);
    // The revoked token now names an empty space of its own.
    expect(await photoIds(guest)).toEqual([]);
    const albums = await guest.request('GET', '/space/albums');
    expect((await albums.json<{ albums: unknown[] }>()).albums).toEqual([]);
    useSpace(guest, second.token);
    const kept = await guest.request('GET', '/space/albums');
    expect((await kept.json<{ albums: unknown[] }>()).albums).toHaveLength(1);
    expect((await owner.request('DELETE', `/space/members/${first.id}`, {})).status).toBe(404);
  });

  it('can leave on their own', async () => {
    const member = await share();
    useSpace(guest, member.token);
    expect((await guest.request('DELETE', '/space/membership', {})).status).toBe(204);
    const res = await owner.request('GET', '/space/members');
    expect((await res.json<MemberList>()).members).toEqual([]);
    // The owner has no membership to leave.
    expect((await owner.request('DELETE', '/space/membership', {})).status).toBe(400);
  });

  it('are listed for the owner as sealed records, keyed by a hash of the token', async () => {
    const member = await share();
    const res = await owner.request('GET', '/space/members');
    expect(await res.json<MemberList>()).toEqual({
      members: [{ id: member.id, meta: expect.any(String) as string, album: null }],
    });
    const dump = JSON.stringify(sqlite.prepare('SELECT * FROM members').all());
    expect(dump).not.toContain(member.token);
    expect(dump).not.toContain(ownerToken);
  });

  it('refuses a taken token or id, malformed members, and too many members', async () => {
    const member = await share();
    expect((await owner.request('POST', '/space/members', { ...member, id: newId() })).status).toBe(
      409,
    );
    expect(
      (await owner.request('POST', '/space/members', { ...member, token: random(16) })).status,
    ).toBe(409);
    expect(
      (await owner.request('POST', '/space/members', { id: newId(), token: 'x', meta: newMeta() }))
        .status,
    ).toBe(400);
    for (let i = 1; i < MAX_MEMBERS; i++) await share();
    expect(
      (
        await owner.request('POST', '/space/members', {
          id: newId(),
          token: random(16),
          meta: newMeta(),
        })
      ).status,
    ).toBe(409);
  });

  it('are forgotten when the owner wipes the space', async () => {
    const member = await share();
    await owner.request('POST', '/space/joined', { id: newId(), meta: newMeta() });
    expect((await owner.request('DELETE', '/space', {})).status).toBe(204);
    expect(sqlite.prepare('SELECT * FROM members').all()).toEqual([]);
    expect(sqlite.prepare('SELECT * FROM joined').all()).toEqual([]);
    useSpace(guest, member.token);
    expect(await photoIds(guest)).toEqual([]);
  });
});

describe('joined libraries', () => {
  it('are stored, listed and removed per space', async () => {
    const joined = { id: newId(), meta: newMeta() };
    expect((await owner.request('POST', '/space/joined', joined)).status).toBe(201);
    expect((await owner.request('POST', '/space/joined', joined)).status).toBe(409);
    const list = await owner.request('GET', '/space/joined');
    expect(await list.json<JoinedList>()).toEqual({ joined: [joined] });
    useSpace(owner, random(16));
    const other = await owner.request('GET', '/space/joined');
    expect(await other.json<JoinedList>()).toEqual({ joined: [] });
    useSpace(owner, ownerToken);
    expect((await owner.request('DELETE', `/space/joined/${joined.id}`, {})).status).toBe(204);
    const after = await owner.request('GET', '/space/joined');
    expect(await after.json<JoinedList>()).toEqual({ joined: [] });
  });

  it('have no account column', () => {
    for (const table of ['members', 'joined', 'invites']) {
      const columns = sqlite
        .prepare(`SELECT name FROM pragma_table_info('${table}')`)
        .all()
        .map((row) => row.name);
      expect(columns).not.toContain('account_id');
    }
  });
});

describe('invites', () => {
  const key = () => random(32);
  const sealed = () => random(120);

  async function create(code = newCode()) {
    const handle = random(16);
    const res = await owner.request('POST', '/invites', { code, handle, commitment: random(32) });
    expect(res.status).toBe(201);
    return { code, handle };
  }

  it('runs every step in order, each side its own, then disappears', async () => {
    const { code, handle } = await create();
    const joinerKey = key();
    const inviterKey = key();
    const hello = sealed();
    const grant = sealed();

    const first = await guest.request('GET', `/invites/join/${code}`);
    expect(await first.json<JoinerView>()).toMatchObject({ inviterKey: null, grant: null });
    // The inviter can't reveal before the joiner has sent a key.
    expect((await owner.request('POST', `/invites/${handle}/reveal`, { inviterKey })).status).toBe(
      409,
    );
    expect((await guest.request('POST', `/invites/join/${code}/key`, { joinerKey })).status).toBe(
      204,
    );
    // ...and the joiner can't say hello before the inviter's key is revealed.
    expect((await guest.request('POST', `/invites/join/${code}/hello`, { hello })).status).toBe(
      409,
    );
    const seen = await owner.request('GET', `/invites/${handle}`);
    expect(await seen.json<InviterView>()).toEqual({ joinerKey, hello: null });
    expect((await owner.request('POST', `/invites/${handle}/reveal`, { inviterKey })).status).toBe(
      204,
    );
    // The inviter can't grant before hearing from the joiner.
    expect((await owner.request('POST', `/invites/${handle}/grant`, { grant })).status).toBe(409);
    expect((await guest.request('POST', `/invites/join/${code}/hello`, { hello })).status).toBe(
      204,
    );
    const withHello = await owner.request('GET', `/invites/${handle}`);
    expect(await withHello.json<InviterView>()).toEqual({ joinerKey, hello });
    expect((await owner.request('POST', `/invites/${handle}/grant`, { grant })).status).toBe(204);
    expect((await owner.request('POST', `/invites/${handle}/grant`, { grant })).status).toBe(409);
    const done = await guest.request('GET', `/invites/join/${code}`);
    expect(await done.json<JoinerView>()).toMatchObject({ inviterKey, grant });
    expect((await guest.request('DELETE', `/invites/join/${code}`, {})).status).toBe(204);
    expect((await owner.request('GET', `/invites/${handle}`)).status).toBe(404);
    expect(sqlite.prepare('SELECT * FROM invites').all()).toEqual([]);
  });

  it('works once', async () => {
    const { code } = await create();
    expect(
      (await guest.request('POST', `/invites/join/${code}/key`, { joinerKey: key() })).status,
    ).toBe(204);
    const third = await signUp('lee@example.com');
    expect(
      (await third.request('POST', `/invites/join/${code}/key`, { joinerKey: key() })).status,
    ).toBe(409);
  });

  it('keeps the code and handle hashed, and links no account or space', async () => {
    const { code, handle } = await create();
    const dump = JSON.stringify(sqlite.prepare('SELECT * FROM invites').all());
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(handle);
    expect(dump).not.toContain(ownerToken);
  });

  it('can’t be driven from the wrong side', async () => {
    const { code, handle } = await create();
    // A joiner with the code can't reach the inviter's routes, which need the handle.
    expect((await guest.request('GET', `/invites/${code}`)).status).toBe(400);
    expect((await guest.request('GET', `/invites/${random(16)}`)).status).toBe(404);
    expect(
      (await guest.request('POST', `/invites/join/${handle}/key`, { joinerKey: key() })).status,
    ).toBe(400);
  });

  it('lets the inviter cancel', async () => {
    const { code, handle } = await create();
    expect((await owner.request('DELETE', `/invites/${handle}`, {})).status).toBe(204);
    expect((await guest.request('GET', `/invites/join/${code}`)).status).toBe(404);
  });

  it('expire', async () => {
    const { code } = await create();
    sqlite.prepare('UPDATE invites SET expires_at = ?').run(Date.now() - 1);
    expect((await guest.request('GET', `/invites/join/${code}`)).status).toBe(404);
    // Creating another invite cleans up the expired ones.
    await create();
    expect(sqlite.prepare('SELECT * FROM invites').all()).toHaveLength(1);
    expect(INVITE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('limits wrong codes per account', async () => {
    const { code } = await create();
    for (let i = 0; i < MAX_FAILURES; i++) {
      expect((await guest.request('GET', `/invites/join/${newCode()}`)).status).toBe(404);
    }
    expect((await guest.request('GET', `/invites/join/${code}`)).status).toBe(429);
    // Other accounts aren't affected.
    const third = await signUp('lee@example.com');
    expect((await third.request('GET', `/invites/join/${code}`)).status).toBe(200);
  });

  it('can’t be raced: parallel wrong codes get no more than the limit', async () => {
    const { code } = await create();
    const results = await Promise.all(
      Array.from({ length: MAX_FAILURES * 3 }, () =>
        guest.request('GET', `/invites/join/${newCode()}`),
      ),
    );
    const statuses = results.map((res) => res.status);
    expect(statuses.filter((status) => status === 404)).toHaveLength(MAX_FAILURES);
    expect(statuses.filter((status) => status === 429)).toHaveLength(MAX_FAILURES * 2);
    expect((await guest.request('GET', `/invites/join/${code}`)).status).toBe(429);
  });

  it('doesn’t count a real code against the limit, however often it’s checked', async () => {
    const { code } = await create();
    for (let i = 0; i < MAX_FAILURES * 2; i++) {
      expect((await guest.request('GET', `/invites/join/${code}`)).status).toBe(200);
    }
  });

  it('refuses malformed codes, keys and messages, and a taken code', async () => {
    const { code } = await create();
    expect(
      (
        await owner.request('POST', '/invites', {
          code,
          handle: random(16),
          commitment: random(32),
        })
      ).status,
    ).toBe(409);
    for (const bad of ['TWO-0000-0000', 'two-abcd-efgh', 'TWO-ABCD']) {
      expect(
        (
          await owner.request('POST', '/invites', {
            code: bad,
            handle: random(16),
            commitment: random(32),
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (await guest.request('POST', `/invites/join/${code}/key`, { joinerKey: random(31) })).status,
    ).toBe(400);
    expect(
      (await guest.request('POST', `/invites/join/${code}/hello`, { hello: random(2000) })).status,
    ).toBe(400);
  });

  it('needs a session', async () => {
    const { code } = await create();
    const stranger = new Client(env);
    expect((await stranger.request('GET', `/invites/join/${code}`)).status).toBe(401);
  });
});
