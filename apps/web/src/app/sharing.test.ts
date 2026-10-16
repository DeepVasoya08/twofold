import { describe, expect, it } from 'vitest';

import { newInviteKeys, newSpace, ownerAccess } from '@twofold/crypto';
import type { SpaceKeys } from '@twofold/crypto';

import { FakeInvites, FakeServer } from '../test/fake-server';
import { FormError } from './account-ops';
import {
  advanceInvite,
  advanceJoin,
  cancelInvite,
  confirmInvite,
  finishJoin,
  leaveAll,
  leaveLibrary,
  listJoined,
  listMembers,
  removeMember,
  sessionStore,
  startInvite,
  startJoin,
} from './sharing';
import type { Invite, Join } from './sharing';
import { remoteStore } from './space-store';
import type { NewPhoto } from './space-store';

const PHOTO: NewPhoto = {
  thumb: new TextEncoder().encode('preview'),
  full: new TextEncoder().encode('original'),
  type: 'image/png',
  width: 10,
  height: 10,
  takenAt: '2026-10-16T09:30:00.000Z',
};

interface World {
  server: FakeServer;
  invites: FakeInvites;
  alice: SpaceKeys;
  bob: SpaceKeys;
}

async function world(): Promise<World> {
  return {
    server: new FakeServer(),
    invites: new FakeInvites(),
    alice: await newSpace(),
    bob: await newSpace(),
  };
}

const apis = (w: World) => ({ invites: w.invites.api, space: w.server.api });

/** Runs an invite up to the point where Alice is asked to confirm. */
async function handshake(w: World) {
  const invite = await startInvite(w.invites.api);
  const join = await startJoin(invite.code, w.invites.api);
  expect(await advanceInvite(invite, w.invites.api)).toEqual({ stage: 'waiting' });
  const joining = await advanceJoin(join, 'Bob', w.invites.api);
  const asked = await advanceInvite(invite, w.invites.api);
  return { invite, join, joining, asked };
}

/** Alice shares her space with Bob, all the way through. */
async function shareAliceWithBob(w: World): Promise<{ invite: Invite; join: Join }> {
  const { invite, join, asked } = await handshake(w);
  if (asked.stage !== 'confirm') throw new Error('expected a confirmation');
  await confirmInvite(invite, asked, w.alice, 'Alice', apis(w));
  const granted = await advanceJoin(join, 'Bob', w.invites.api);
  if (granted.stage !== 'granted') throw new Error('expected a grant');
  await finishJoin(join, granted.grant, w.bob, apis(w));
  return { invite, join };
}

describe('invites', () => {
  it('show both sides the same safety phrase, and the joiner’s name', async () => {
    const w = await world();
    const { joining, asked } = await handshake(w);
    expect(joining.stage).toBe('waiting');
    if (joining.stage !== 'waiting' || asked.stage !== 'confirm') throw new Error('wrong stage');
    expect(asked.name).toBe('Bob');
    expect(joining.phrase).toHaveLength(4);
    expect(asked.phrase).toEqual(joining.phrase);
  });

  it('give the joiner the library, and the owner a member', async () => {
    const w = await world();
    await shareAliceWithBob(w);
    expect(await listMembers(w.alice, w.server.api)).toEqual([
      { id: expect.any(String) as string, name: 'Bob' },
    ]);
    const [library] = await listJoined(w.bob, w.server.api);
    expect(library).toMatchObject({ name: 'Alice' });
    // The invite is gone once the joiner has what it needs.
    expect(w.invites.invites.size).toBe(0);
  });

  it('hand over the records key and a token of the joiner’s own, never the space id', async () => {
    const w = await world();
    await shareAliceWithBob(w);
    const [library] = await listJoined(w.bob, w.server.api);
    const owner = await ownerAccess(w.alice);
    expect(library?.token).not.toBe(owner.token);
    expect(JSON.stringify(library)).not.toContain(Buffer.from(w.alice.spaceKey).toString('base64'));
  });

  it('can’t be finished by a server that swaps the inviter’s key', async () => {
    const w = await world();
    const invite = await startInvite(w.invites.api);
    const join = await startJoin(invite.code, w.invites.api);
    await advanceInvite(invite, w.invites.api);
    const stored = w.invites.invites.get(invite.code);
    if (!stored) throw new Error('missing invite');
    stored.inviterKey = (await newInviteKeys()).publicKey;
    await expect(advanceJoin(join, 'Bob', w.invites.api)).rejects.toThrow(FormError);
    expect(stored.hello).toBeNull();
  });

  it('can’t be confirmed when a server swaps the joiner’s key', async () => {
    const w = await world();
    const invite = await startInvite(w.invites.api);
    const join = await startJoin(invite.code, w.invites.api);
    const stored = w.invites.invites.get(invite.code);
    if (!stored) throw new Error('missing invite');
    const mallory = await newInviteKeys();
    stored.joinerKey = mallory.publicKey;
    await advanceInvite(invite, w.invites.api);
    // Bob's hello was sealed for the real exchange, so it doesn't open as Mallory's.
    await advanceJoin(join, 'Bob', w.invites.api);
    await expect(advanceInvite(invite, w.invites.api)).rejects.toThrow(FormError);
    expect(await listMembers(w.alice, w.server.api)).toEqual([]);
  });

  it('refuse a tampered grant', async () => {
    const w = await world();
    const { invite, join, asked } = await handshake(w);
    if (asked.stage !== 'confirm') throw new Error('expected a confirmation');
    await confirmInvite(invite, asked, w.alice, 'Alice', apis(w));
    const stored = w.invites.invites.get(invite.code);
    if (!stored?.grant) throw new Error('missing grant');
    stored.grant = `${stored.grant.slice(0, 40)}${stored.grant[40] === 'A' ? 'B' : 'A'}${stored.grant.slice(41)}`;
    await expect(advanceJoin(join, 'Bob', w.invites.api)).rejects.toThrow(FormError);
  });

  it('end when the inviter cancels', async () => {
    const w = await world();
    const invite = await startInvite(w.invites.api);
    await cancelInvite(invite, w.invites.api);
    await expect(startJoin(invite.code, w.invites.api)).rejects.toThrow(/isn’t valid anymore/);
  });

  it('work once', async () => {
    const w = await world();
    const invite = await startInvite(w.invites.api);
    await startJoin(invite.code, w.invites.api);
    await expect(startJoin(invite.code, w.invites.api)).rejects.toThrow();
  });
});

describe('a shared library', () => {
  it('shows the owner’s photos to the member, with whose they are', async () => {
    const w = await world();
    await remoteStore(w.alice, w.server.api).add(PHOTO, []);
    await shareAliceWithBob(w);
    const { photos } = await sessionStore(w.bob, 'Bob', w.server.api).list();
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({ library: 'Alice', addedBy: 'contact', addedByName: 'Alice' });
  });

  it('files what a member adds to a shared album in the owner’s space, under their name', async () => {
    const w = await world();
    const album = await remoteStore(w.alice, w.server.api).createAlbum('Trip');
    await shareAliceWithBob(w);
    const bobs = sessionStore(w.bob, 'Bob', w.server.api);
    const { albums } = await bobs.list();
    expect(albums).toEqual([{ ...album, library: 'Alice' }]);
    const added = await bobs.add(PHOTO, [album.id]);
    expect(added).toMatchObject({ addedBy: 'me', library: 'Alice' });
    // A new photo outside a shared album stays in Bob's own space.
    expect((await bobs.add(PHOTO, [])).library).toBeUndefined();

    const { photos } = await sessionStore(w.alice, 'Alice', w.server.api).list();
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({ addedBy: 'contact', addedByName: 'Bob' });
    expect(photos[0]?.library).toBeUndefined();
  });

  it('routes favorites and deletes to the library a photo is in', async () => {
    const w = await world();
    const added = await remoteStore(w.alice, w.server.api).add(PHOTO, []);
    await shareAliceWithBob(w);
    const bobs = sessionStore(w.bob, 'Bob', w.server.api);
    const [photo] = (await bobs.list()).photos;
    if (!photo) throw new Error('missing photo');
    await bobs.update({ ...photo, favorite: true });
    const [seen] = (await remoteStore(w.alice, w.server.api).list()).photos;
    expect(seen).toMatchObject({ id: added.id, favorite: true });
    await bobs.remove(photo.id);
    expect((await remoteStore(w.alice, w.server.api).list()).photos).toEqual([]);
  });

  it('stops reaching the member once the owner stops sharing', async () => {
    const w = await world();
    await remoteStore(w.alice, w.server.api).add(PHOTO, []);
    await shareAliceWithBob(w);
    const [member] = await listMembers(w.alice, w.server.api);
    if (!member) throw new Error('missing member');
    await removeMember(w.alice, member.id, w.server.api);
    expect((await sessionStore(w.bob, 'Bob', w.server.api).list()).photos).toEqual([]);
  });

  it('can be left by the member', async () => {
    const w = await world();
    await shareAliceWithBob(w);
    const [library] = await listJoined(w.bob, w.server.api);
    if (!library) throw new Error('missing library');
    await leaveLibrary(w.bob, library, w.server.api);
    expect(await listJoined(w.bob, w.server.api)).toEqual([]);
    expect(await listMembers(w.alice, w.server.api)).toEqual([]);
  });

  it('is left before an account’s space is wiped', async () => {
    const w = await world();
    await shareAliceWithBob(w);
    await leaveAll(w.bob, w.server.api);
    expect(await listMembers(w.alice, w.server.api)).toEqual([]);
  });

  it('doesn’t let a member see what the owner joined or shared', async () => {
    const w = await world();
    await shareAliceWithBob(w);
    const [library] = await listJoined(w.bob, w.server.api);
    if (!library) throw new Error('missing library');
    const asMember = w.server.api(library.token);
    await expect(asMember.listJoined()).rejects.toThrow();
    await expect(asMember.listMembers()).rejects.toThrow();
    await expect(asMember.wipe()).rejects.toThrow();
  });
});
