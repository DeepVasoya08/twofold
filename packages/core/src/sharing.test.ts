import { describe, expect, it, vi } from 'vitest';

import {
  albumAccess,
  fromBase64Url,
  newInviteKeys,
  newSpace,
  openRecord,
  ownerAccess,
  sealSharedFolder,
} from '@arcafold/crypto';
import type { SpaceKeys } from '@arcafold/crypto';
import type { MemberAccess } from '@arcafold/types';

import { FakeInvites, FakeServer } from './testing/fake-server';
import {
  abandonJoin,
  advanceInvite,
  advanceJoin,
  cancelInvite,
  checkJoin,
  confirmInvite,
  finishJoin,
  forgetPending,
  joinedAccess,
  leaveAll,
  leaveJoined,
  leaveLibrary,
  listJoined,
  listMembers,
  listPending,
  listStillJoined,
  removeMember,
  sessionStore,
  setInviteAccess,
  startInvite,
  startJoin,
  updateMemberAccess,
} from './sharing';
import type { Invite, Join } from './sharing';
import { FormError } from './errors';
import { VIEW_ONLY_LIBRARY, combinedStore, remoteStore } from './library/space-store';
import { encodeFolderShareMeta } from './records';
import type { NewPhoto, SpaceStore } from './library/space-store';

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

/**
 * Runs an invite up to the point where Alice is asked to confirm. Bob accepts by the link;
 * each later step is what that side's next visit does.
 */
async function handshake(w: World, album: string | null = null) {
  const invite = await startInvite(w.alice, album, apis(w));
  expect(await advanceInvite(invite, 'Alice', w.alice, apis(w))).toEqual({ stage: 'waiting' });
  const join = await startJoin(invite.link, w.bob, apis(w));
  expect(await advanceJoin(join, 'Bob', w.invites.api)).toEqual({ stage: 'waiting' });
  // Alice's next visit reveals her key; her name goes with it, sealed to Bob.
  expect(await advanceInvite(invite, 'Alice', w.alice, apis(w))).toEqual({ stage: 'accepted' });
  // Bob's next visit checks it, sends his name, and shows the words.
  const joining = await advanceJoin(join, 'Bob', w.invites.api);
  const asked = await advanceInvite(invite, 'Alice', w.alice, apis(w));
  return { invite, join, joining, asked };
}

/** Alice shares her space with Bob, all the way through, letting him do `access`. */
async function shareAliceWithBob(
  w: World,
  access: MemberAccess = 'edit',
): Promise<{ invite: Invite; join: Join }> {
  const { invite, join, asked } = await handshake(w);
  if (asked.stage !== 'confirm') throw new Error('expected a confirmation');
  if (access !== invite.access) await setInviteAccess(invite, access, w.alice, apis(w));
  await confirmInvite(invite, asked, w.alice, 'Alice', apis(w));
  const granted = await advanceJoin(join, 'Bob', w.invites.api);
  if (granted.stage !== 'granted') throw new Error('expected a grant');
  await finishJoin(join, granted.grant, w.bob, apis(w));
  return { invite, join };
}

/** Alice shares one album with Bob, all the way through, from her store. */
async function shareAlbumWithBob(
  w: World,
  alices: SpaceStore,
  albumId: string,
  access: MemberAccess = 'view',
) {
  const { invite, join, asked } = await handshake(w, albumId);
  if (asked.stage !== 'confirm') throw new Error('expected a confirmation');
  if (access !== invite.access) await setInviteAccess(invite, access, w.alice, apis(w));
  const albumKey = await alices.shareAlbum(albumId);
  await confirmInvite(invite, asked, w.alice, 'Alice', apis(w), { albumId, albumKey });
  const granted = await advanceJoin(join, 'Bob', w.invites.api);
  if (granted.stage !== 'granted') throw new Error('expected a grant');
  await finishJoin(join, granted.grant, w.bob, apis(w));
  return granted.grant;
}

/** Flips one character of a base64url string in its middle. */
function tamper(text: string): string {
  const at = Math.floor(text.length / 2);
  return `${text.slice(0, at)}${text[at] === 'A' ? 'B' : 'A'}${text.slice(at + 1)}`;
}

describe('invites', () => {
  it('show both sides the same safety phrase, and each the other’s name', async () => {
    const w = await world();
    const { joining, asked } = await handshake(w);
    if (joining.stage !== 'check' || asked.stage !== 'confirm') throw new Error('wrong stage');
    expect(asked.name).toBe('Bob');
    expect(joining.name).toBe('Alice');
    expect(joining.phrase).toHaveLength(4);
    expect(asked.phrase).toEqual(joining.phrase);
  });

  it('give the joiner the library, and the owner a member', async () => {
    const w = await world();
    await shareAliceWithBob(w);
    expect(await listMembers(w.alice, w.server.api)).toEqual([
      { id: expect.any(String) as string, name: 'Bob', album: null, access: 'edit' },
    ]);
    const [library] = await listJoined(w.bob, w.server.api);
    expect(library).toMatchObject({ name: 'Alice' });
    // The invite is gone once the joiner has what it needs, and so are both records.
    expect(w.invites.invites.size).toBe(0);
    expect(w.server.pending.size).toBe(0);
  });

  it('hand over the records key and a token of the joiner’s own, never the space id', async () => {
    const w = await world();
    await shareAliceWithBob(w);
    const [library] = await listJoined(w.bob, w.server.api);
    const owner = await ownerAccess(w.alice);
    expect(library?.token).not.toBe(owner.token);
    expect(JSON.stringify(library)).not.toContain(Buffer.from(w.alice.spaceKey).toString('base64'));
  });

  it('work with the typed code as well as the link', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, apis(w));
    expect(invite.code).toMatch(/^TWO-/);
    expect(invite.link).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const join = await startJoin(invite.code, w.bob, apis(w));
    await advanceInvite(invite, 'Alice', w.alice, apis(w));
    expect((await advanceJoin(join, 'Bob', w.invites.api)).stage).toBe('check');
  });

  it('can’t be finished by a server that swaps the inviter’s key', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, apis(w));
    const join = await startJoin(invite.link, w.bob, apis(w));
    await advanceInvite(invite, 'Alice', w.alice, apis(w));
    const stored = w.invites.invites.get(invite.code);
    if (!stored) throw new Error('missing invite');
    stored.inviterKey = (await newInviteKeys()).publicKey;
    await expect(advanceJoin(join, 'Bob', w.invites.api)).rejects.toThrow(FormError);
    expect(stored.hello).toBeNull();
  });

  it('refuse a tampered or replaced inviter’s name', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, apis(w));
    const join = await startJoin(invite.link, w.bob, apis(w));
    await advanceInvite(invite, 'Alice', w.alice, apis(w));
    const stored = w.invites.invites.get(invite.code);
    if (!stored?.intro) throw new Error('missing intro');
    stored.intro = tamper(stored.intro);
    await expect(advanceJoin(join, 'Bob', w.invites.api)).rejects.toThrow(FormError);
    expect(stored.hello).toBeNull();
  });

  it('pin the joiner’s key before revealing, and refuse any other afterwards', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, apis(w));
    const join = await startJoin(invite.link, w.bob, apis(w));
    await advanceInvite(invite, 'Alice', w.alice, apis(w));
    const [kept] = (await listPending(w.alice, apis(w))).invites;
    expect(kept?.joinerKey).toBe(join.keys.publicKey);
    await advanceJoin(join, 'Bob', w.invites.api);
    // A server that knows Alice's key now could search for a joiner key whose words match
    // Bob's. Showing it to Alice, on this visit or a later one, ends the invite.
    const stored = w.invites.invites.get(invite.code);
    if (!stored || !kept) throw new Error('missing invite');
    const mallory = await newInviteKeys();
    stored.joinerKey = mallory.publicKey;
    await expect(advanceInvite(invite, 'Alice', w.alice, apis(w))).rejects.toThrow(FormError);
    await expect(advanceInvite(kept, 'Alice', w.alice, apis(w))).rejects.toThrow(FormError);
  });

  it('wait for the pinned key when another device has revealed already', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, apis(w));
    const join = await startJoin(invite.link, w.bob, apis(w));
    // This device loaded the record before the other one pinned the key and revealed.
    const [stale] = (await listPending(w.alice, apis(w))).invites;
    await advanceInvite(invite, 'Alice', w.alice, apis(w));
    await advanceJoin(join, 'Bob', w.invites.api);
    if (!stale) throw new Error('missing invite');
    expect(stale.joinerKey).toBeNull();
    expect(await advanceInvite(stale, 'Alice', w.alice, apis(w))).toEqual({ stage: 'accepted' });
    const [fresh] = (await listPending(w.alice, apis(w))).invites;
    if (!fresh) throw new Error('missing invite');
    expect((await advanceInvite(fresh, 'Alice', w.alice, apis(w))).stage).toBe('confirm');
  });

  it('don’t reveal anything if the joiner’s key can’t be pinned first', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, apis(w));
    await startJoin(invite.link, w.bob, apis(w));
    const failing = {
      ...apis(w),
      space: (token: string) => ({
        ...w.server.api(token),
        updatePendingInvite: () => Promise.reject(new Error('offline')),
      }),
    };
    await expect(advanceInvite(invite, 'Alice', w.alice, failing)).rejects.toThrow('offline');
    expect(w.invites.invites.get(invite.code)?.inviterKey).toBeNull();
  });

  it('can’t be confirmed when a server swaps the joiner’s key', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, apis(w));
    const join = await startJoin(invite.link, w.bob, apis(w));
    const stored = w.invites.invites.get(invite.code);
    if (!stored) throw new Error('missing invite');
    const mallory = await newInviteKeys();
    stored.joinerKey = mallory.publicKey;
    await advanceInvite(invite, 'Alice', w.alice, apis(w));
    // Alice's name was sealed to Mallory's key, so Bob can't open it, and never says hello.
    await expect(advanceJoin(join, 'Bob', w.invites.api)).rejects.toThrow(FormError);
    expect(stored.hello).toBeNull();
    expect(await listMembers(w.alice, w.server.api)).toEqual([]);
  });

  it('refuse a tampered grant', async () => {
    const w = await world();
    const { invite, join, asked } = await handshake(w);
    if (asked.stage !== 'confirm') throw new Error('expected a confirmation');
    await confirmInvite(invite, asked, w.alice, 'Alice', apis(w));
    const stored = w.invites.invites.get(invite.code);
    if (!stored?.grant) throw new Error('missing grant');
    stored.grant = tamper(stored.grant);
    await expect(advanceJoin(join, 'Bob', w.invites.api)).rejects.toThrow(FormError);
  });

  it('end when the inviter cancels, for both sides and their records', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, apis(w));
    await cancelInvite(invite, w.alice, apis(w));
    expect(w.server.pending.size).toBe(0);
    await expect(startJoin(invite.link, w.bob, apis(w))).rejects.toThrow(/link isn’t valid/);
    await expect(startJoin(invite.code, w.bob, apis(w))).rejects.toThrow(/code isn’t valid/);
    expect(w.server.pending.size).toBe(0);
  });

  it('work once', async () => {
    const w = await world();
    const carol = await newSpace();
    const invite = await startInvite(w.alice, null, apis(w));
    await startJoin(invite.link, w.bob, apis(w));
    await expect(startJoin(invite.code, carol, apis(w))).rejects.toThrow(/already accepted/);
    // Carol's failed attempt leaves nothing behind in her space.
    expect((await listPending(carol, apis(w))).joins).toEqual([]);
  });

  it('report an expired invite as gone to both sides', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, apis(w));
    const join = await startJoin(invite.link, w.bob, apis(w));
    w.invites.invites.clear();
    expect(await advanceInvite(invite, 'Alice', w.alice, apis(w))).toEqual({ stage: 'gone' });
    expect(await advanceJoin(join, 'Bob', w.invites.api)).toEqual({ stage: 'gone' });
    await expect(checkJoin(invite.link, w.invites.api)).rejects.toThrow(FormError);
  });

  it('don’t keep a record of an invite the server refused', async () => {
    const w = await world();
    const failing = {
      ...apis(w),
      invites: { ...w.invites.api, create: () => Promise.reject(new Error('offline')) },
    };
    await expect(startInvite(w.alice, null, failing)).rejects.toThrow('offline');
    expect(w.server.pending.size).toBe(0);
  });

  it('cancel the server’s invite if the record can’t be kept', async () => {
    const w = await world();
    const failing = {
      ...apis(w),
      space: (token: string) => ({
        ...w.server.api(token),
        addPendingInvite: () => Promise.reject(new Error('full')),
      }),
    };
    await expect(startInvite(w.alice, null, failing)).rejects.toThrow('full');
    expect(w.invites.invites.size).toBe(0);
  });
});

describe('invites across visits', () => {
  /** What a new device (or the next visit) knows: only the space's sealed records. */
  async function reopen(space: SpaceKeys, w: World) {
    return listPending(space, apis(w));
  }

  it('are finished from the sealed records alone, on each side’s later visits', async () => {
    const w = await world();
    const alices = remoteStore(w.alice, w.server.api);
    const album = await alices.createAlbum('Trip');
    await alices.list();
    const started = await startInvite(w.alice, album.id, apis(w));
    const accepted = await startJoin(started.link, w.bob, apis(w));
    // Both tabs close; everything below starts from the records.

    const [invite] = (await reopen(w.alice, w)).invites;
    if (!invite) throw new Error('missing invite');
    expect(invite).toMatchObject({
      id: started.id,
      code: started.code,
      link: started.link,
      handle: started.handle,
      album: album.id,
    });
    expect(invite.keys.publicKey).toBe(started.keys.publicKey);
    expect(await advanceInvite(invite, 'Alice', w.alice, apis(w))).toEqual({ stage: 'accepted' });

    const [join] = (await reopen(w.bob, w)).joins;
    if (!join) throw new Error('missing join');
    expect(join).toMatchObject({ id: accepted.id, ref: started.link });
    const joining = await advanceJoin(join, 'Bob', w.invites.api);
    if (joining.stage !== 'check') throw new Error('expected the words');
    // Visiting again doesn't send a second hello.
    expect(await advanceJoin(join, 'Bob', w.invites.api)).toEqual(joining);

    const [later] = (await reopen(w.alice, w)).invites;
    if (!later) throw new Error('missing invite');
    const asked = await advanceInvite(later, 'Alice', w.alice, apis(w));
    if (asked.stage !== 'confirm') throw new Error('expected a confirmation');
    expect(asked.phrase).toEqual(joining.phrase);
    const albumKey = await alices.shareAlbum(album.id);
    await confirmInvite(later, asked, w.alice, 'Alice', apis(w), { albumId: album.id, albumKey });
    expect((await reopen(w.alice, w)).invites).toEqual([]);

    const [again] = (await reopen(w.bob, w)).joins;
    if (!again) throw new Error('missing join');
    const granted = await advanceJoin(again, 'Bob', w.invites.api);
    if (granted.stage !== 'granted') throw new Error('expected a grant');
    expect(granted.name).toBe('Alice');
    expect(granted.grant.album).toBe(album.id);
    await finishJoin(again, granted.grant, w.bob, apis(w));
    // The joined record takes the pending record's id; finishing twice keeps one copy.
    await finishJoin(again, granted.grant, w.bob, apis(w));
    const joined = await listJoined(w.bob, w.server.api);
    expect(joined.map((each) => each.id)).toEqual([accepted.id]);
    expect(w.server.pending.size).toBe(0);
  });

  it('are kept sealed: the server sees no key, handle, code or link', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, apis(w));
    const join = await startJoin(invite.link, w.bob, apis(w));
    const stored = JSON.stringify([...w.server.pending.values()]);
    for (const secret of [invite.handle, invite.code, invite.link, join.commitment]) {
      expect(stored).not.toContain(secret);
    }
    expect(stored).not.toContain(Buffer.from(invite.keys.secretKey).toString('base64url'));
    expect(stored).not.toContain(Buffer.from(join.keys.secretKey).toString('base64url'));
  });

  it('are kept in the space they belong to, and members can’t read them', async () => {
    const w = await world();
    await startInvite(w.alice, null, apis(w));
    const other = await newSpace();
    expect(await reopen(other, w)).toEqual({ invites: [], joins: [] });
    await shareAliceWithBob(w);
    const [library] = await listJoined(w.bob, w.server.api);
    if (!library) throw new Error('missing library');
    await expect(w.server.api(library.token).listPendingInvites()).rejects.toThrow();
  });

  it('skip records that were tampered with or don’t open', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, apis(w));
    const entry = w.server.pending.get(invite.id);
    if (!entry) throw new Error('missing record');
    entry.invite = { ...entry.invite, meta: tamper(entry.invite.meta) };
    expect((await reopen(w.alice, w)).invites).toEqual([]);
    // Opening with the wrong space's key doesn't work either.
    entry.token = (await ownerAccess(w.bob)).token;
    expect((await reopen(w.bob, w)).invites).toEqual([]);
  });

  it('are forgotten once the server says the invite is gone', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, apis(w));
    w.invites.invites.clear();
    expect(await advanceInvite(invite, 'Alice', w.alice, apis(w))).toEqual({ stage: 'gone' });
    await forgetPending(w.alice, invite.id, apis(w));
    expect((await reopen(w.alice, w)).invites).toEqual([]);
  });

  it('can be given up by the joiner', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, apis(w));
    const join = await startJoin(invite.link, w.bob, apis(w));
    await abandonJoin(join, w.bob, apis(w));
    expect((await reopen(w.bob, w)).joins).toEqual([]);
    expect(await advanceInvite(invite, 'Alice', w.alice, apis(w))).toEqual({ stage: 'gone' });
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
    expect(albums[0]?.viewOnly).toBeUndefined();
    const added = await bobs.add(PHOTO, [album.id]);
    expect(added).toMatchObject({ addedBy: 'me', library: 'Alice' });
    // A new photo outside a shared album stays in Bob's own space.
    expect((await bobs.add(PHOTO, [])).library).toBeUndefined();

    const { photos } = await sessionStore(w.alice, 'Alice', w.server.api).list();
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({ addedBy: 'contact', addedByName: 'Bob' });
    expect(photos[0]?.library).toBeUndefined();
  });

  it('routes album renames and deletes to the library the album is in', async () => {
    const w = await world();
    const album = await remoteStore(w.alice, w.server.api).createAlbum('Trip');
    await shareAliceWithBob(w);
    const bobs = sessionStore(w.bob, 'Bob', w.server.api);
    await bobs.list();
    await bobs.renameAlbum(album.id, 'Our trip');
    const alices = remoteStore(w.alice, w.server.api);
    expect((await alices.list()).albums).toEqual([{ id: album.id, title: 'Our trip' }]);
    await bobs.removeAlbum(album.id);
    expect((await alices.list()).albums).toEqual([]);
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

  it('can be shared view-only: photos and albums marked, and every change refused', async () => {
    const w = await world();
    const alices = remoteStore(w.alice, w.server.api);
    const album = await alices.createAlbum('Trip');
    await alices.add(PHOTO, [album.id]);
    await shareAliceWithBob(w, 'view');
    expect(await listMembers(w.alice, w.server.api)).toMatchObject([{ access: 'view' }]);
    const bobs = sessionStore(w.bob, 'Bob', w.server.api);
    const { photos, albums } = await bobs.list();
    expect(photos[0]).toMatchObject({ library: 'Alice', viewOnly: true });
    expect(photos[0]?.sharedAlbum).toBeUndefined();
    expect(albums[0]).toMatchObject({ library: 'Alice', viewOnly: true });
    const photo = photos[0];
    if (!photo) throw new Error('missing photo');
    await expect(bobs.update({ ...photo, favorite: true })).rejects.toThrow(VIEW_ONLY_LIBRARY);
    await expect(bobs.remove(photo.id)).rejects.toThrow(VIEW_ONLY_LIBRARY);
    await expect(bobs.renameAlbum(album.id, 'Mine now')).rejects.toThrow(VIEW_ONLY_LIBRARY);
    await expect(bobs.removeAlbum(album.id)).rejects.toThrow(VIEW_ONLY_LIBRARY);
    await expect(bobs.add(PHOTO, [album.id])).rejects.toThrow(VIEW_ONLY_LIBRARY);
    // Bob can still download, and still upload to his own space.
    expect((await bobs.original(photo.id)).type).toBe('image/png');
    expect((await bobs.add(PHOTO, [])).library).toBeUndefined();
    // The server refuses too, whatever the app does.
    const [library] = await listJoined(w.bob, w.server.api);
    if (!library) throw new Error('missing library');
    const asBob = w.server.api(library.token);
    await expect(Promise.resolve().then(() => asBob.deletePhoto(photo.id))).rejects.toThrow();
    expect((await alices.list()).photos).toHaveLength(1);
  });

  it('lets the owner change what a member can do, which the member sees next time', async () => {
    const w = await world();
    const alices = remoteStore(w.alice, w.server.api);
    await alices.add(PHOTO, []);
    await shareAliceWithBob(w, 'view');
    const [library] = await listJoined(w.bob, w.server.api);
    const [member] = await listMembers(w.alice, w.server.api);
    if (!library || !member) throw new Error('missing share');
    expect(await joinedAccess(library, w.server.api)).toBe('view');

    await updateMemberAccess(w.alice, member.id, 'edit', w.server.api);
    expect(await joinedAccess(library, w.server.api)).toBe('edit');
    const bobs = sessionStore(w.bob, 'Bob', w.server.api);
    const [photo] = (await bobs.list()).photos;
    if (!photo) throw new Error('missing photo');
    expect(photo.viewOnly).toBeUndefined();
    await bobs.update({ ...photo, favorite: true });
    expect((await alices.list()).photos[0]?.favorite).toBe(true);

    await updateMemberAccess(w.alice, member.id, 'view', w.server.api);
    const again = sessionStore(w.bob, 'Bob', w.server.api);
    expect((await again.list()).photos[0]?.viewOnly).toBe(true);
  });

  it('starts invites view-only and keeps the choice in the invite’s record, for albums too', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, apis(w));
    expect(invite.access).toBe('view');
    await setInviteAccess(invite, 'edit', w.alice, apis(w));
    // Another device, or a later visit, reads the choice back.
    const { invites } = await listPending(w.alice, apis(w));
    expect(invites[0]?.access).toBe('edit');

    const album = await remoteStore(w.alice, w.server.api).createAlbum('Trip');
    const albumInvite = await startInvite(w.alice, album.id, apis(w));
    expect(albumInvite.access).toBe('view');
    await setInviteAccess(albumInvite, 'edit', w.alice, apis(w));
    const after = await listPending(w.alice, apis(w));
    expect(after.invites.find((each) => each.id === albumInvite.id)?.access).toBe('edit');
  });

  it('treats a library whose access can’t be read as view-only', async () => {
    const w = await world();
    await remoteStore(w.alice, w.server.api).add(PHOTO, []);
    await shareAliceWithBob(w, 'edit');
    const [library] = await listJoined(w.bob, w.server.api);
    if (!library) throw new Error('missing library');
    const failing = (token: string) => ({
      ...w.server.api(token),
      membership: () => Promise.reject(new Error('offline')),
    });
    expect(await joinedAccess(library, failing)).toBe('view');
  });

  it('stops reaching the member once the owner stops sharing', async () => {
    const w = await world();
    await remoteStore(w.alice, w.server.api).add(PHOTO, []);
    await shareAliceWithBob(w);
    const [member] = await listMembers(w.alice, w.server.api);
    if (!member) throw new Error('missing member');
    await removeMember(w.alice, member.id, w.server.api);
    expect((await sessionStore(w.bob, 'Bob', w.server.api).list()).photos).toEqual([]);
    // Bob's record of it is forgotten too, so it leaves his Shared with you.
    expect(await listJoined(w.bob, w.server.api)).toEqual([]);
  });

  it('drops only libraries the server no longer knows, not ones it couldn’t reach', async () => {
    const w = await world();
    await shareAliceWithBob(w, 'view');
    const offline = (token: string) => ({
      ...w.server.api(token),
      membership: () => Promise.reject(new Error('offline')),
    });
    expect(await listStillJoined(w.bob, offline)).toMatchObject([
      { name: 'Alice', access: 'view' },
    ]);
    expect(await listStillJoined(w.bob, w.server.api)).toMatchObject([{ access: 'view' }]);

    const [member] = await listMembers(w.alice, w.server.api);
    if (!member) throw new Error('missing member');
    await removeMember(w.alice, member.id, w.server.api);
    expect(await listStillJoined(w.bob, w.server.api)).toEqual([]);
    expect(await listJoined(w.bob, w.server.api)).toEqual([]);
  });

  it('drops an album whose owner stopped sharing it', async () => {
    const w = await world();
    const alices = remoteStore(w.alice, w.server.api);
    const album = await alices.createAlbum('Trip');
    await alices.list();
    await shareAlbumWithBob(w, alices, album.id);
    expect(await listStillJoined(w.bob, w.server.api)).toMatchObject([
      { album: album.id, access: 'view' },
    ]);
    await alices.stopSharingAlbum(album.id);
    expect(await listStillJoined(w.bob, w.server.api)).toEqual([]);
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

describe('a shared album', () => {
  /** Alice's store with an album of two photos and one photo outside it, shared with Bob. */
  async function sharedAlbum() {
    const w = await world();
    const alices = remoteStore(w.alice, w.server.api);
    const album = await alices.createAlbum('Trip');
    await alices.createAlbum('Private');
    const first = await alices.add(PHOTO, [album.id]);
    const second = await alices.add(PHOTO, [album.id]);
    const outside = await alices.add(PHOTO, []);
    await alices.list();
    const grant = await shareAlbumWithBob(w, alices, album.id);
    const bobs = () => sessionStore(w.bob, 'Bob', w.server.api);
    return { w, alices, album, first, second, outside, grant, bobs };
  }

  it('shows Bob only that album and its photos, marked as shared with him', async () => {
    const { album, first, second, bobs } = await sharedAlbum();
    const { photos, albums } = await bobs().list();
    expect(albums).toEqual([
      {
        id: album.id,
        title: 'Trip',
        library: 'Alice',
        sharedAlbum: true,
        viewOnly: true,
        joinedId: expect.any(String) as string,
      },
    ]);
    expect(photos.map((photo) => photo.id).sort()).toEqual([first.id, second.id].sort());
    for (const photo of photos) {
      expect(photo).toMatchObject({ library: 'Alice', sharedAlbum: true, albumIds: [album.id] });
      expect(photo.favorite).toBe(false);
    }
  });

  it('hands over the album’s own key, which can’t open the rest of the library', async () => {
    const { w, outside, grant } = await sharedAlbum();
    const owner = await ownerAccess(w.alice);
    expect(grant.album).toBeDefined();
    expect(grant.recordKey).not.toBe(Buffer.from(owner.recordKey).toString('base64url'));
    expect(grant.token).not.toBe(owner.token);
    const stored = w.server.photos.get(outside.id)?.photo;
    if (!stored) throw new Error('missing photo');
    const access = albumAccess(grant.token, Buffer.from(grant.recordKey, 'base64url'));
    await expect(openRecord(access, 'photo', outside.id, stored.meta)).rejects.toThrow();
  });

  it('can’t be changed by Bob', async () => {
    const { first, album, bobs } = await sharedAlbum();
    const store = bobs();
    const [photo] = (await store.list()).photos;
    if (!photo) throw new Error('missing photo');
    await expect(store.update({ ...photo, favorite: true })).rejects.toThrow();
    await expect(store.remove(first.id)).rejects.toThrow();
    await expect(store.renameAlbum(album.id, 'Mine')).rejects.toThrow();
    await expect(store.add(PHOTO, [album.id])).rejects.toThrow();
  });

  it('follows photos Alice adds, takes out, and the album’s new name', async () => {
    const { alices, album, first, outside, bobs } = await sharedAlbum();
    const outsidePhoto = (await alices.list()).photos.find((photo) => photo.id === outside.id);
    const firstPhoto = (await alices.list()).photos.find((photo) => photo.id === first.id);
    if (!outsidePhoto || !firstPhoto) throw new Error('missing photo');
    await alices.update({ ...outsidePhoto, albumIds: [album.id] });
    await alices.update({ ...firstPhoto, albumIds: [] });
    await alices.renameAlbum(album.id, 'Our trip');
    const added = await alices.add(PHOTO, [album.id]);
    const { photos, albums } = await bobs().list();
    expect(photos.map((photo) => photo.id)).toContain(outside.id);
    expect(photos.map((photo) => photo.id)).toContain(added.id);
    expect(photos.map((photo) => photo.id)).not.toContain(first.id);
    expect(albums[0]?.title).toBe('Our trip');
  });

  it('keeps Alice’s favorites and other albums to herself', async () => {
    const { w, alices, album, first, bobs } = await sharedAlbum();
    const other = (await alices.list()).albums.find((each) => each.title === 'Private');
    const photo = (await alices.list()).photos.find((each) => each.id === first.id);
    if (!other || !photo) throw new Error('missing');
    await alices.update({ ...photo, favorite: true, albumIds: [album.id, other.id] });
    const seen = (await bobs().list()).photos.find((each) => each.id === first.id);
    expect(seen).toMatchObject({ favorite: false, albumIds: [album.id] });
    expect(w.server.items.size).toBe(2);
  });

  it('lists the people it’s shared with for Alice', async () => {
    const { w, album } = await sharedAlbum();
    const { albums } = await sessionStore(w.alice, 'Alice', w.server.api).list();
    expect(albums.find((each) => each.id === album.id)?.sharedWith).toEqual(['Bob']);
    expect(await listMembers(w.alice, w.server.api)).toEqual([
      { id: expect.any(String) as string, name: 'Bob', album: album.id, access: 'view' },
    ]);
  });

  it('stops for Bob when Alice stops sharing, and a new share gets a new key', async () => {
    const { w, alices, album, grant, bobs } = await sharedAlbum();
    await alices.stopSharingAlbum(album.id);
    expect(await bobs().list()).toEqual({ photos: [], albums: [], folders: [] });
    const again = await shareAlbumWithBob(w, alices, album.id);
    expect(again.recordKey).not.toBe(grant.recordKey);
    expect((await bobs().list()).photos).toHaveLength(2);
  });

  it('stops for Bob when the album is deleted, and can be left', async () => {
    const first = await sharedAlbum();
    await first.alices.removeAlbum(first.album.id);
    expect((await first.bobs().list()).albums).toEqual([]);

    const second = await sharedAlbum();
    const [joined] = await listJoined(second.w.bob, second.w.server.api);
    if (!joined) throw new Error('missing album');
    await leaveJoined(second.w.bob, joined.id, second.w.server.api);
    expect(await listJoined(second.w.bob, second.w.server.api)).toEqual([]);
    expect(await listMembers(second.w.alice, second.w.server.api)).toEqual([]);
  });

  it('can only be shared by its owner', async () => {
    const w = await world();
    const album = await remoteStore(w.alice, w.server.api).createAlbum('Trip');
    await shareAliceWithBob(w);
    const bobs = sessionStore(w.bob, 'Bob', w.server.api);
    await bobs.list();
    await expect(bobs.shareAlbum(album.id)).rejects.toThrow(FormError);
  });
});

describe('an album Bob may add to', () => {
  async function editableAlbum() {
    const w = await world();
    const alices = remoteStore(w.alice, w.server.api);
    const album = await alices.createAlbum('Trip');
    const first = await alices.add(PHOTO, [album.id]);
    await alices.list();
    await shareAlbumWithBob(w, alices, album.id, 'edit');
    const bobs = sessionStore(w.bob, 'Bob', w.server.api);
    return { w, alices, album, first, bobs };
  }

  /** Waits for Alice's device to seal again what Bob added, as it does behind a list. */
  async function sealedAgain(w: World, photoId: string) {
    await vi.waitFor(() => {
      expect(w.server.photos.get(photoId)?.photo.sealedForAlbum).toBeUndefined();
    });
  }

  it('shows Bob the album as one he can add to, and Alice who can edit', async () => {
    const { w, album, bobs } = await editableAlbum();
    const { albums, photos } = await bobs.list();
    expect(albums[0]).toMatchObject({ id: album.id, sharedAlbum: true });
    expect(albums[0]?.viewOnly).toBeUndefined();
    expect(photos[0]).toMatchObject({ sharedAlbum: true });
    expect(photos[0]?.viewOnly).toBeUndefined();
    expect(await listMembers(w.alice, w.server.api)).toEqual([
      { id: expect.any(String) as string, name: 'Bob', album: album.id, access: 'edit' },
    ]);
  });

  it('files what Bob adds in the album, which Alice’s device then keeps as her own', async () => {
    const { w, alices, album, bobs } = await editableAlbum();
    await bobs.list();
    const added = await bobs.add(PHOTO, [album.id]);
    expect(w.server.photos.get(added.id)?.photo.sealedForAlbum).toBe(album.id);
    expect((await bobs.list()).photos.map((photo) => photo.id)).toContain(added.id);

    const seen = (await alices.list()).photos.find((photo) => photo.id === added.id);
    expect(seen).toMatchObject({ albumIds: [album.id], favorite: false, addedBy: 'contact' });
    expect(seen?.addedByName).toBe('Bob');
    await sealedAgain(w, added.id);
    // Sealed again under Alice's records key, it opens like any of hers, even after the
    // album stops being shared and its key goes.
    await alices.stopSharingAlbum(album.id);
    const later = (await remoteStore(w.alice, w.server.api).list()).photos;
    expect(later.find((photo) => photo.id === added.id)?.albumIds).toEqual([album.id]);
  });

  it('lets Bob take any photo out of the album, without deleting it', async () => {
    const { w, alices, album, first, bobs } = await editableAlbum();
    const photo = (await bobs.list()).photos.find((each) => each.id === first.id);
    if (!photo) throw new Error('missing photo');
    await bobs.update({ ...photo, albumIds: [] });
    expect((await bobs.list()).photos).toEqual([]);

    const mine = (await alices.list()).photos.find((each) => each.id === first.id);
    expect(mine?.albumIds).toEqual([]);
    expect(w.server.removed.size).toBe(0);
    // Sharing the album again doesn't put it back.
    await alices.shareAlbum(album.id);
    expect((await bobs.list()).photos).toEqual([]);
  });

  it('still keeps Bob from changing anything else', async () => {
    const { first, album, bobs } = await editableAlbum();
    const [photo] = (await bobs.list()).photos;
    if (!photo) throw new Error('missing photo');
    await expect(bobs.update({ ...photo, favorite: true })).rejects.toThrow();
    await expect(bobs.remove(first.id)).rejects.toThrow(FormError);
    await expect(bobs.trash([first.id], new Date().toISOString())).rejects.toThrow(FormError);
    await expect(bobs.renameAlbum(album.id, 'Mine')).rejects.toThrow(FormError);
    await expect(bobs.removeAlbum(album.id)).rejects.toThrow(FormError);
  });

  it('can be switched between viewing and adding by Alice', async () => {
    const { w, album, bobs } = await editableAlbum();
    const [member] = await listMembers(w.alice, w.server.api);
    if (!member) throw new Error('missing member');
    await updateMemberAccess(w.alice, member.id, 'view', w.server.api);
    expect((await bobs.list()).albums[0]?.viewOnly).toBe(true);
    await expect(bobs.add(PHOTO, [album.id])).rejects.toThrow();
  });
});

describe('a shared folder', () => {
  /**
   * Alice's Files: Taxes holding a photo and Receipts (holding one more), and Car beside it
   * with one of its own, Taxes shared with Bob.
   */
  async function sharedFolder(access: MemberAccess = 'view') {
    const w = await world();
    const alices = remoteStore(w.alice, w.server.api);
    const taxes = await alices.createFolder('Taxes');
    const receipts = await alices.createFolder('Receipts', taxes.id);
    const car = await alices.createFolder('Car');
    const inTaxes = await alices.add(PHOTO, [taxes.id]);
    const inReceipts = await alices.add(PHOTO, [receipts.id]);
    const inCar = await alices.add(PHOTO, [car.id]);
    await alices.add(PHOTO, []);
    await alices.list();
    await shareAlbumWithBob(w, alices, taxes.id, access);
    const bobs = () => sessionStore(w.bob, 'Bob', w.server.api);
    return { w, alices, taxes, receipts, car, inTaxes, inReceipts, inCar, bobs };
  }

  const ids = (items: readonly { id: string }[]) => items.map((item) => item.id).sort();

  it('lists the same for Bob each time, with the same store', async () => {
    const { bobs } = await sharedFolder('edit');
    const store = bobs();
    const first = await store.list();
    const again = await store.list();
    expect(again.folders).toEqual(first.folders);
    expect(again.photos.map((photo) => photo.albumIds)).toEqual(
      first.photos.map((photo) => photo.albumIds),
    );
  });

  it('shows Bob that folder, the folders inside it and what they hold, filed where they are', async () => {
    const { taxes, receipts, inTaxes, inReceipts, bobs } = await sharedFolder();
    const { photos, folders, albums } = await bobs().list();
    expect(albums).toEqual([]);
    expect(folders).toEqual([
      {
        id: taxes.id,
        name: 'Taxes',
        library: 'Alice',
        viewOnly: true,
        sharedFolder: true,
        joinedId: expect.any(String) as string,
      },
      {
        id: receipts.id,
        name: 'Receipts',
        parentId: taxes.id,
        library: 'Alice',
        viewOnly: true,
        sharedFolder: true,
      },
    ]);
    expect(ids(photos)).toEqual(ids([inTaxes, inReceipts]));
    expect(photos.find((photo) => photo.id === inReceipts.id)?.albumIds).toEqual([receipts.id]);
    expect(photos.find((photo) => photo.id === inTaxes.id)?.albumIds).toEqual([taxes.id]);
  });

  it('lists who it’s shared with for Alice', async () => {
    const { w, taxes } = await sharedFolder();
    const { folders } = await sessionStore(w.alice, 'Alice', w.server.api).list();
    expect(folders.find((folder) => folder.id === taxes.id)?.sharedWith).toEqual(['Bob']);
  });

  it('follows new folders, files moved in and out, renames and folders moved away', async () => {
    const { alices, taxes, receipts, car, inTaxes, inCar, bobs } = await sharedFolder();
    const old = await alices.createFolder('Old', receipts.id);
    const all = (await alices.list()).photos;
    const photo = (id: string) => {
      const found = all.find((each) => each.id === id);
      if (!found) throw new Error('missing photo');
      return found;
    };
    await alices.update({ ...photo(inCar.id), albumIds: [old.id] });
    await alices.update({ ...photo(inTaxes.id), albumIds: [] });
    await alices.saveFolder({ ...taxes, name: 'Taxes 2025' });
    let seen = await bobs().list();
    expect(seen.folders.map((folder) => folder.name)).toEqual(['Taxes 2025', 'Receipts', 'Old']);
    expect(seen.photos.find((each) => each.id === inCar.id)?.albumIds).toEqual([old.id]);
    expect(ids(seen.photos)).not.toContain(inTaxes.id);

    // Receipts leaves Taxes, with what's inside it: none of it is shared now.
    await alices.saveFolder({ id: receipts.id, name: 'Receipts', parentId: car.id });
    seen = await bobs().list();
    expect(seen.folders.map((folder) => folder.name)).toEqual(['Taxes 2025']);
    expect(seen.photos).toEqual([]);
  });

  it('stops being shared when it goes to Recently deleted', async () => {
    const { w, alices, taxes } = await sharedFolder();
    await alices.saveFolder({ ...taxes, deletedAt: '2026-11-25T00:00:00.000Z' });
    expect(await listStillJoined(w.bob, w.server.api)).toEqual([]);
  });

  it('can’t be changed by Bob, nor added to while he may only view it', async () => {
    const { taxes, bobs } = await sharedFolder();
    const store = bobs();
    await store.list();
    await expect(store.add(PHOTO, [taxes.id])).rejects.toThrow();
    await expect(store.createFolder('Mine', taxes.id)).rejects.toThrow();
    await expect(store.saveFolder({ ...taxes, name: 'Mine' })).rejects.toThrow();
  });

  it('takes what Bob adds, into the folder inside it he chose, which Alice then keeps', async () => {
    const { w, alices, taxes, receipts, bobs } = await sharedFolder('edit');
    const store = bobs();
    const { folders } = await store.list();
    expect(folders[0]?.viewOnly).toBeUndefined();
    const added = await store.add(PHOTO, [receipts.id]);
    expect(w.server.photos.get(added.id)?.photo.sealedForAlbum).toBe(taxes.id);
    const again = await bobs().list();
    expect(again.photos.find((photo) => photo.id === added.id)?.albumIds).toEqual([receipts.id]);

    const seen = (await alices.list()).photos.find((photo) => photo.id === added.id);
    expect(seen).toMatchObject({ albumIds: [receipts.id], addedBy: 'contact' });
    await vi.waitFor(() => {
      expect(w.server.photos.get(added.id)?.photo.sealedForAlbum).toBeUndefined();
    });
  });

  it('shares a folder with many folders inside it', async () => {
    const w = await world();
    const alices = remoteStore(w.alice, w.server.api);
    const archive = await alices.createFolder('Archive');
    for (let year = 1990; year < 2050; year += 1) {
      await alices.createFolder(`Year ${String(year)} and everything from it`, archive.id);
    }
    await alices.list();
    await shareAlbumWithBob(w, alices, archive.id, 'view');
    const { folders } = await sessionStore(w.bob, 'Bob', w.server.api).list();
    expect(folders).toHaveLength(61);
  });
});

describe('changes inside a folder shared to edit', () => {
  const FILE: NewPhoto = {
    ...PHOTO,
    type: 'application/pdf',
    file: { name: 'return.pdf' },
  };
  const at = '2026-11-25T10:00:00.000Z';

  /** Alice's Taxes (holding a photo, a file and Receipts, with one more) shared with Bob to edit. */
  async function editable() {
    const w = await world();
    const alices = remoteStore(w.alice, w.server.api);
    const taxes = await alices.createFolder('Taxes');
    const receipts = await alices.createFolder('Receipts', taxes.id);
    const inTaxes = await alices.add(PHOTO, [taxes.id]);
    const file = await alices.add(FILE, [taxes.id]);
    const inReceipts = await alices.add(PHOTO, [receipts.id]);
    await alices.list();
    await shareAlbumWithBob(w, alices, taxes.id, 'edit');
    const bobs = async () => {
      const store = sessionStore(w.bob, 'Bob', w.server.api);
      const listed = await store.list();
      return { store, listed };
    };
    const alice = () => remoteStore(w.alice, w.server.api);
    const waiting = () => w.server.folderEdits.get(taxes.id)?.length ?? 0;
    return { w, taxes, receipts, inTaxes, file, inReceipts, bobs, alice, waiting };
  }

  const byId = <T extends { id: string }>(items: readonly T[], id: string) => {
    const found = items.find((item) => item.id === id);
    if (!found) throw new Error(`missing ${id}`);
    return found;
  };

  it('lets Bob make, rename and move folders; everyone sees it, and Alice’s device makes it', async () => {
    const { taxes, receipts, bobs, alice, waiting } = await editable();
    const { store } = await bobs();
    const year = await store.createFolder('2025', taxes.id);
    expect(year).toMatchObject({ name: '2025', parentId: taxes.id, sharedFolder: true });
    await store.saveFolder({ ...receipts, name: 'Bills', parentId: year.id });
    // Made, renamed, moved.
    expect(waiting()).toBe(3);

    // Bob sees it straight away, from the changes still waiting.
    const before = (await bobs()).listed.folders;
    expect(byId(before, year.id)).toMatchObject({ name: '2025', parentId: taxes.id });
    expect(byId(before, receipts.id)).toMatchObject({ name: 'Bills', parentId: year.id });

    // Alice's device makes them in her own records, and the server forgets them.
    const { folders } = await alice().list();
    expect(byId(folders, year.id)).toMatchObject({ name: '2025', parentId: taxes.id });
    expect(byId(folders, receipts.id)).toMatchObject({ name: 'Bills', parentId: year.id });
    expect(waiting()).toBe(0);
    const after = (await bobs()).listed.folders;
    expect(byId(after, receipts.id)).toMatchObject({ name: 'Bills', parentId: year.id });
  });

  it('lets Bob rename a file, move files and delete one into Alice’s Recently deleted', async () => {
    const { taxes, receipts, inTaxes, file, inReceipts, bobs, alice } = await editable();
    const { store, listed } = await bobs();
    const seenFile = byId(listed.photos, file.id);
    if (!seenFile.file) throw new Error('not a file');
    await store.update({ ...seenFile, file: { ...seenFile.file, name: 'Return 2025.pdf' } });
    await store.update({ ...byId(listed.photos, inTaxes.id), albumIds: [receipts.id] });
    expect(await store.trash([inReceipts.id], at)).toEqual([inReceipts.id]);

    const bobSees = (await bobs()).listed.photos;
    expect(byId(bobSees, file.id).file?.name).toBe('Return 2025.pdf');
    expect(byId(bobSees, inTaxes.id).albumIds).toEqual([receipts.id]);
    expect(bobSees.map((photo) => photo.id)).not.toContain(inReceipts.id);

    const store2 = alice();
    const { photos } = await store2.list();
    expect(byId(photos, file.id).file?.name).toBe('Return 2025.pdf');
    expect(byId(photos, inTaxes.id).albumIds).toEqual([receipts.id]);
    expect(photos.map((photo) => photo.id)).not.toContain(inReceipts.id);
    const trash = await store2.listTrash();
    expect(byId(trash, inReceipts.id).deletedAt).toBe(at);
    expect(byId(trash, inReceipts.id).albumIds).toEqual([receipts.id]);
    // And it's still where it was for Bob after Alice's device caught up.
    const bobAfter = (await bobs()).listed.photos;
    expect(byId(bobAfter, inTaxes.id).albumIds).toEqual([receipts.id]);
    expect(taxes.id).toBeDefined();
  });

  it('deletes a folder with what is inside it, together, so it comes back together', async () => {
    const { receipts, inReceipts, bobs, alice } = await editable();
    const { store, listed } = await bobs();
    // As the apps delete a folder: files first, then the folder.
    await store.trash([inReceipts.id], at);
    await store.saveFolder({ ...byId(listed.folders, receipts.id), deletedAt: at });
    expect((await bobs()).listed.folders.map((folder) => folder.id)).not.toContain(receipts.id);

    const store2 = alice();
    const { folders } = await store2.list();
    expect(byId(folders, receipts.id).deletedAt).toBe(at);
    expect(byId(await store2.listTrash(), inReceipts.id).deletedAt).toBe(at);
  });

  it('files what Bob adds to a folder he just made in it, for Alice too', async () => {
    const { taxes, bobs, alice } = await editable();
    const { store } = await bobs();
    const scans = await store.createFolder('Scans', taxes.id);
    const added = await store.add(PHOTO, [scans.id]);
    expect(byId((await bobs()).listed.photos, added.id).albumIds).toEqual([scans.id]);
    const { photos, folders } = await alice().list();
    expect(byId(folders, scans.id).parentId).toBe(taxes.id);
    expect(byId(photos, added.id).albumIds).toEqual([scans.id]);
  });

  it('keeps the shared folder itself, and what’s in it, Alice’s', async () => {
    const { taxes, inTaxes, receipts, bobs, waiting } = await editable();
    const { store, listed } = await bobs();
    await expect(
      store.saveFolder({ ...byId(listed.folders, taxes.id), name: 'Mine' }),
    ).rejects.toThrow(FormError);
    await expect(
      store.saveFolder({ ...byId(listed.folders, taxes.id), deletedAt: at }),
    ).rejects.toThrow(FormError);
    // Nothing leaves it: not a file, not a folder.
    await expect(
      store.update({ ...byId(listed.photos, inTaxes.id), albumIds: [] }),
    ).rejects.toThrow(FormError);
    const top = { ...byId(listed.folders, receipts.id) };
    delete top.parentId;
    await expect(store.saveFolder(top)).rejects.toThrow(FormError);
    // A folder can't go inside itself.
    const inside = await store.createFolder('Inside', receipts.id);
    await expect(store.saveFolder({ ...top, parentId: inside.id })).rejects.toThrow(FormError);
    expect(waiting()).toBe(1);
  });

  it('can’t be changed by someone who may only view it', async () => {
    const { w, taxes, receipts, inReceipts } = await editable();
    const bobId = [...w.server.members.values()].find((m) => m.album === taxes.id)?.id;
    if (!bobId) throw new Error('no member');
    await updateMemberAccess(w.alice, bobId, 'view', w.server.api);
    const store = sessionStore(w.bob, 'Bob', w.server.api);
    const listed = await store.list();
    await expect(store.createFolder('Mine', taxes.id)).rejects.toThrow();
    await expect(
      store.saveFolder({ ...byId(listed.folders, receipts.id), name: 'X' }),
    ).rejects.toThrow();
    await expect(store.trash([inReceipts.id], at)).rejects.toThrow();
    expect(w.server.folderEdits.get(taxes.id)).toBeUndefined();
  });

  it('lets go of a change that doesn’t open or no longer makes sense', async () => {
    const { w, taxes, receipts, bobs, alice, waiting } = await editable();
    const { store, listed } = await bobs();
    await store.saveFolder({ ...byId(listed.folders, receipts.id), name: 'Bills' });
    w.server.folderEdits.set(taxes.id, [
      ...(w.server.folderEdits.get(taxes.id) ?? []),
      { id: 'forged', meta: tamper(w.server.folderEdits.get(taxes.id)?.[0]?.meta ?? '') },
    ]);
    const { folders } = await alice().list();
    expect(byId(folders, receipts.id).name).toBe('Bills');
    expect(waiting()).toBe(0);
  });
});

describe('one file shared on its own', () => {
  const FILE: NewPhoto = { ...PHOTO, type: 'application/pdf', file: { name: 'lease.pdf' } };
  const NEW_VERSION: NewPhoto = {
    ...PHOTO,
    full: new TextEncoder().encode('signed'),
    type: 'application/pdf',
    file: { name: 'lease signed.pdf' },
  };

  /** Alice's lease, in her Home folder, shared with Bob; a photo and another file stay hers. */
  async function sharedFile(access: MemberAccess = 'view') {
    const w = await world();
    const alices = remoteStore(w.alice, w.server.api);
    const home = await alices.createFolder('Home');
    const lease = await alices.add(FILE, [home.id]);
    const other = await alices.add({ ...FILE, file: { name: 'other.pdf' } }, [home.id]);
    await alices.add(PHOTO, []);
    await alices.list();
    const shareId = await alices.shareFile(lease.id);
    await shareAlbumWithBob(w, alices, shareId, access);
    const bobs = () => sessionStore(w.bob, 'Bob', w.server.api);
    const alice = () => sessionStore(w.alice, 'Alice', w.server.api);
    return { w, alices, home, lease, other, shareId, bobs, alice };
  }

  const byId = <T extends { id: string }>(items: readonly T[], id: string) => {
    const found = items.find((item) => item.id === id);
    if (!found) throw new Error(`missing ${id}`);
    return found;
  };

  it('shows Bob that file alone, and Alice who it’s shared with', async () => {
    const { lease, shareId, bobs, alice } = await sharedFile();
    const seen = await bobs().list();
    expect(seen.folders).toEqual([]);
    expect(seen.albums).toEqual([]);
    expect(seen.photos.map((photo) => photo.id)).toEqual([lease.id]);
    expect(seen.photos[0]).toMatchObject({
      sharedFile: true,
      sharedAlbum: true,
      viewOnly: true,
      library: 'Alice',
      albumIds: [],
      joinedId: expect.any(String) as string,
      file: { name: 'lease.pdf' },
    });
    const mine = byId((await alice().list()).photos, lease.id);
    expect(mine).toMatchObject({ shareId, sharedWith: ['Bob'] });
    // The row it's shared through is no album or folder of hers.
    const listed = await alice().list();
    expect(listed.albums).toEqual([]);
    expect(listed.folders.map((folder) => folder.name)).toEqual(['Home']);
  });

  it('follows Alice renaming it, and ends when she stops sharing it or deletes it', async () => {
    const { w, alices, lease, shareId, bobs } = await sharedFile();
    const own = byId((await alices.list()).photos, lease.id);
    if (!own.file) throw new Error('not a file');
    await alices.update({ ...own, file: { ...own.file, name: 'Lease 2026.pdf' } });
    expect(byId((await bobs().list()).photos, lease.id).file?.name).toBe('Lease 2026.pdf');
    await alices.stopSharingAlbum(shareId);
    expect(await listStillJoined(w.bob, w.server.api)).toEqual([]);
    expect(byId((await alices.list()).photos, lease.id).shareId).toBeUndefined();
  });

  it('tells an open app when anything it shows changes, and only then', async () => {
    const { w, alices, lease, shareId, bobs } = await sharedFile();
    const store = bobs();
    const before = await store.list();
    expect(before.photos[0]?.viewOnly).toBe(true);
    const first = await store.stamp();
    expect(await store.stamp()).toBe(first);

    // Alice renames it: Bob's stamp moves, and listing again with the same store shows it.
    const own = byId((await alices.list()).photos, lease.id);
    if (!own.file) throw new Error('not a file');
    await alices.update({ ...own, file: { ...own.file, name: 'Lease 2026.pdf' } });
    const renamed = await store.stamp();
    expect(renamed).not.toBe(first);
    expect(byId((await store.list()).photos, lease.id).file?.name).toBe('Lease 2026.pdf');

    // So does Alice letting him edit it.
    const [member] = await listMembers(w.alice, w.server.api);
    if (!member) throw new Error('no member');
    await updateMemberAccess(w.alice, member.id, 'edit', w.server.api);
    expect(await store.stamp()).not.toBe(renamed);
    expect(byId((await store.list()).photos, lease.id).viewOnly).toBeFalsy();
    const editable = await store.stamp();

    // And her stopping: the share is gone from his next listing.
    await alices.stopSharingAlbum(shareId);
    expect(await store.stamp()).not.toBe(editable);
    expect((await store.list()).photos).toEqual([]);
  });

  it('lets Bob, with Can edit, rename it and upload a new version that takes its place', async () => {
    const { w, lease, home, shareId, bobs, alice } = await sharedFile('edit');
    const store = bobs();
    const seen = byId((await store.list()).photos, lease.id);
    if (!seen.file) throw new Error('not a file');
    await store.update({ ...seen, file: { ...seen.file, name: 'Lease (Bob).pdf' } });
    const added = await store.replaceFile(lease.id, NEW_VERSION);
    expect(added).toMatchObject({ sharedFile: true, library: 'Alice' });
    const bobSees = (await bobs().list()).photos;
    expect(bobSees.map((photo) => photo.id)).toEqual([added.id]);
    expect(bobSees[0]?.file?.name).toBe('lease signed.pdf');

    // Alice's library takes it in: the new version where the old one was, shared in its place.
    const mine = await alice().list();
    const next = byId(mine.photos, added.id);
    expect(next).toMatchObject({ albumIds: [home.id], shareId });
    expect(mine.photos.map((photo) => photo.id)).not.toContain(lease.id);
    const trash = await remoteStore(w.alice, w.server.api).listTrash();
    expect(byId(trash, lease.id).file?.name).toBe('Lease (Bob).pdf');
    expect(w.server.folderEdits.get(shareId)).toBeUndefined();
    expect((await bobs().list()).photos.map((photo) => photo.id)).toEqual([added.id]);
  });

  it('keeps Bob to renaming and new versions, and to nothing while he may only view it', async () => {
    const { lease, bobs } = await sharedFile('edit');
    const store = bobs();
    await store.list();
    await expect(store.trash([lease.id], '2026-11-25T10:00:00.000Z')).rejects.toThrow(FormError);

    const viewer = await sharedFile('view');
    const watching = viewer.bobs();
    const seen = byId((await watching.list()).photos, viewer.lease.id);
    if (!seen.file) throw new Error('not a file');
    await expect(
      watching.update({ ...seen, file: { ...seen.file, name: 'x.pdf' } }),
    ).rejects.toThrow();
    await expect(watching.replaceFile(viewer.lease.id, NEW_VERSION)).rejects.toThrow();
  });

  it('shares only files of your own', async () => {
    const { alices, bobs, lease } = await sharedFile('edit');
    const photo = (await alices.list()).photos.find((each) => !each.file);
    if (!photo) throw new Error('no photo');
    await expect(alices.shareFile(photo.id)).rejects.toThrow(FormError);
    const store = bobs();
    await store.list();
    await expect(store.shareFile(lease.id)).rejects.toThrow(FormError);
  });
});

describe('a share that names your own albums or folders', () => {
  /**
   * Bob keeps a Medical folder and a Holiday album to himself. Alice shares her folder
   * From Alice with him to add to, then rewrites its record (she holds its key) so it lists
   * Bob's Medical inside it, and a folder of hers inside Bob's Medical.
   */
  async function claimed() {
    const w = await world();
    const bobsOwn = remoteStore(w.bob, w.server.api);
    const medical = await bobsOwn.createFolder('Medical');
    const holiday = await bobsOwn.createAlbum('Holiday');
    await bobsOwn.list();
    const alices = remoteStore(w.alice, w.server.api);
    const from = await alices.createFolder('From Alice');
    await alices.list();
    const grant = await shareAlbumWithBob(w, alices, from.id, 'edit');
    const folderKey = fromBase64Url(grant.recordKey);
    if (!folderKey) throw new Error('expected a folder key');
    const aliceToken = (await ownerAccess(w.alice)).token;
    const record = encodeFolderShareMeta({
      v: 1,
      kind: 'folder',
      name: 'From Alice',
      folders: [
        { id: medical.id, name: 'Medical', parent: from.id },
        { id: 'trapAAAAAAAAAAAAAAAAAA', name: 'Upload here', parent: medical.id },
      ],
    });
    await w.server
      .api(aliceToken)
      .shareAlbum(
        from.id,
        await sealSharedFolder(albumAccess(aliceToken, folderKey), from.id, record),
      );
    const bobToken = (await ownerAccess(w.bob)).token;
    return { w, medical, holiday, from, aliceToken, bobToken };
  }

  it('shows Bob his own folder once, as his, and nothing of hers inside it', async () => {
    const { w, medical, from } = await claimed();
    const { folders } = await sessionStore(w.bob, 'Bob', w.server.api).list();
    expect(folders.map((folder) => [folder.id, folder.library])).toEqual([
      [medical.id, undefined],
      [from.id, 'Alice'],
    ]);
  });

  it('keeps what Bob adds to his own folder in his own library, out of Alice’s reach', async () => {
    const { w, medical, aliceToken, bobToken } = await claimed();
    const bobs = sessionStore(w.bob, 'Bob', w.server.api);
    await bobs.list();
    const added = await bobs.add(PHOTO, [medical.id]);
    expect(added.library).toBeUndefined();
    expect(w.server.photos.get(added.id)?.token).toBe(bobToken);
    expect(w.server.photos.get(added.id)?.token).not.toBe(aliceToken);
    const alices = await remoteStore(w.alice, w.server.api).list();
    expect(alices.photos.map((photo) => photo.id)).not.toContain(added.id);
  });

  it('keeps Bob’s new folders and renames in his own library', async () => {
    const { w, medical, bobToken } = await claimed();
    const bobs = sessionStore(w.bob, 'Bob', w.server.api);
    await bobs.list();
    const scans = await bobs.createFolder('Scans', medical.id);
    expect(scans.library).toBeUndefined();
    await bobs.saveFolder({ ...medical, name: 'Health' });
    expect(w.server.albums.get(scans.id)?.token).toBe(bobToken);
    expect(w.server.albums.get(medical.id)?.token).toBe(bobToken);
    const own = await remoteStore(w.bob, w.server.api).list();
    expect(own.folders.find((folder) => folder.id === medical.id)?.name).toBe('Health');
  });

  it('lets Bob share and stop sharing his own folder as before', async () => {
    const { w, medical } = await claimed();
    const bobs = sessionStore(w.bob, 'Bob', w.server.api);
    await bobs.list();
    await expect(bobs.shareAlbum(medical.id)).resolves.toBeInstanceOf(Uint8Array);
    await expect(bobs.stopSharingAlbum(medical.id)).resolves.toBeUndefined();
  });

  it('keeps a shared library’s albums and photos out of Bob’s own albums', async () => {
    const { w, holiday, bobToken } = await claimed();
    // A server that lists Bob's album, and puts Alice's photos in it, as part of her library.
    await remoteStore(w.alice, w.server.api).add(PHOTO, []);
    const theirs = remoteStore(w.alice, w.server.api);
    const lying: SpaceStore = {
      ...theirs,
      list: async () => {
        const listed = await theirs.list();
        return {
          ...listed,
          albums: [...listed.albums, { ...holiday, title: 'Holiday' }],
          photos: listed.photos.map((photo) => ({
            ...photo,
            albumIds: [...photo.albumIds, holiday.id],
          })),
        };
      },
    };
    const bobs = combinedStore(remoteStore(w.bob, w.server.api), () =>
      Promise.resolve([{ id: 'joined', name: 'Alice', store: lying }]),
    );
    const { albums, photos } = await bobs.list();
    expect(albums.filter((album) => album.id === holiday.id)).toEqual([
      expect.not.objectContaining({ library: 'Alice' }),
    ]);
    expect(photos.some((photo) => photo.albumIds.includes(holiday.id))).toBe(false);
    const added = await bobs.add(PHOTO, [holiday.id]);
    expect(w.server.photos.get(added.id)?.token).toBe(bobToken);
  });
});
