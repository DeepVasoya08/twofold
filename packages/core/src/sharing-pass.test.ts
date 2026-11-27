import { describe, expect, it } from 'vitest';

import { newInviteKeys, newSpace, sealForPeer } from '@arcafold/crypto';

import { advancePending, grantedText, passInterval } from './sharing-pass';
import type { InviteEntry, JoinEntry, SeenJoiners } from './sharing-pass';
import {
  cancelInvite,
  confirmInvite,
  listJoined,
  shownJoiner,
  startInvite,
  startJoin,
} from './sharing';
import { FakeInvites, FakeServer } from './testing/fake-server';

const NONE = { invites: new Map(), joins: new Map() };

async function world() {
  const server = new FakeServer();
  const invites = new FakeInvites();
  return {
    apis: { invites: invites.api, space: server.api },
    alice: await newSpace(),
    bob: await newSpace(),
  };
}

describe('advancePending', () => {
  it('takes both sides through an invite, pass by pass, until the library is shared', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, w.apis);
    let alice = await advancePending(w.alice, 'Alice', w.apis, new Set(), NONE, new Map());
    expect(alice.invites.map((entry) => entry.progress.stage)).toEqual(['waiting']);

    await startJoin(invite.code, w.bob, w.apis);
    alice = await advancePending(w.alice, 'Alice', w.apis, new Set(), NONE, new Map());
    expect(alice.invites[0]?.progress.stage).toBe('accepted');
    let bob = await advancePending(w.bob, 'Bob', w.apis, new Set(), NONE, new Map());
    expect(bob.joins[0]?.progress.stage).toBe('check');

    alice = await advancePending(w.alice, 'Alice', w.apis, new Set(), NONE, new Map());
    const asked = alice.invites[0];
    if (asked?.progress.stage !== 'confirm') throw new Error('Alice should be asked to confirm');
    expect(asked.progress.name).toBe('Bob');
    await confirmInvite(
      asked.invite,
      { name: asked.progress.name, joinerKey: asked.progress.joinerKey },
      w.alice,
      'Alice',
      w.apis,
    );

    bob = await advancePending(w.bob, 'Bob', w.apis, new Set(), NONE, new Map());
    expect(bob.granted.map(({ ref, name, album }) => ({ ref, name, album }))).toEqual([
      { ref: invite.code, name: 'Alice', album: false },
    ]);
    expect(bob.joins).toEqual([]);
    expect(await listJoined(w.bob, w.apis.space)).toHaveLength(1);
  });

  it('leaves alone what was settled on this device meanwhile', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, w.apis);
    const result = await advancePending(
      w.alice,
      'Alice',
      w.apis,
      new Set([invite.id]),
      NONE,
      new Map(),
    );
    expect(result.invites).toEqual([]);
  });

  it('reports a cancelled invite as gone to the joiner', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, w.apis);
    const join = await startJoin(invite.link, w.bob, w.apis);
    await cancelInvite(invite, w.alice, w.apis);
    const bob = await advancePending(w.bob, 'Bob', w.apis, new Set(), NONE, new Map());
    expect(bob.goneJoins.map((each) => each.id)).toEqual([join.id]);
  });
});

describe('a server that puts back an older invite record', () => {
  /** Alice's request shows Bob's words; the server kept her record from before the pin. */
  async function compared() {
    const server = new FakeServer();
    const invites = new FakeInvites();
    const apis = { invites: invites.api, space: server.api };
    const alice = await newSpace();
    const bob = await newSpace();
    const invite = await startInvite(alice, null, apis);
    const stored = server.pending.get(invite.id);
    if (!stored) throw new Error('Alice should keep a record');
    const beforePin = { ...stored.invite };
    await startJoin(invite.link, bob, apis);
    const seen: SeenJoiners = new Map();
    await advancePending(alice, 'Alice', apis, new Set(), NONE, seen);
    await advancePending(bob, 'Bob', apis, new Set(), NONE, new Map());
    const pass = await advancePending(alice, 'Alice', apis, new Set(), NONE, seen);
    const shown = pass.invites[0]?.progress;
    if (shown?.stage !== 'confirm') throw new Error('Alice should be asked to confirm');
    const record = [...invites.invites.values()][0];
    if (!record?.inviterKey) throw new Error('Alice should have revealed her key');
    const rollBack = () => {
      const entry = server.pending.get(invite.id);
      if (entry) entry.invite = beforePin;
    };
    return {
      server,
      apis,
      alice,
      invite,
      seen,
      shown,
      record,
      inviterKey: record.inviterKey,
      rollBack,
    };
  }

  it('ends the invite instead of showing words for a key nobody compared', async () => {
    const w = await compared();
    // After the words were compared, the server puts back the record from before the pin and
    // shows a key of its own, with a hello under Bob's name.
    w.rollBack();
    const theirs = await newInviteKeys();
    const hello = new TextEncoder().encode(JSON.stringify({ v: 1, name: 'Bob' }));
    Object.assign(w.record, {
      joinerKey: theirs.publicKey,
      inviterKey: null,
      intro: null,
      hello: await sealForPeer('hello', hello, w.inviterKey, theirs),
    });

    const pass = await advancePending(w.alice, 'Alice', w.apis, new Set(), NONE, w.seen);
    expect(pass.invites).toEqual([]);
    expect(pass.goneInvites).toEqual([w.invite.id]);
    expect(pass.problems).toEqual([expect.stringMatching(/couldn’t be verified/)]);
    expect(w.record.grant).toBeNull();
    expect(w.seen.has(w.invite.id)).toBe(false);
  });

  it('puts back a key the record lost and shows the same words', async () => {
    const w = await compared();
    w.rollBack();
    const pass = await advancePending(w.alice, 'Alice', w.apis, new Set(), NONE, w.seen);
    expect(pass.invites[0]?.progress).toEqual(w.shown);
    expect(pass.invites[0]?.invite.joinerKey).toBe(w.shown.joinerKey);
  });

  it('shares only with the key behind the words that were shown', async () => {
    const w = await compared();
    expect(shownJoiner(w.shown, w.shown.joinerKey)).toEqual({
      name: 'Bob',
      joinerKey: w.shown.joinerKey,
    });
    const other = (await newInviteKeys()).publicKey;
    expect(() => shownJoiner(w.shown, other)).toThrow(/couldn’t be verified/);
    expect(() => shownJoiner({ stage: 'accepted' }, w.shown.joinerKey)).toThrow(/haven’t joined/);
  });
});

describe('grantedText', () => {
  it('says what was shared', () => {
    expect(grantedText({ name: 'Sam', album: true })).toBe(
      'Sam shared an album, folder or file with you',
    );
    expect(grantedText({ name: 'Sam', album: false })).toBe('You joined Sam’s library');
  });
});

describe('passInterval', () => {
  const every = { watching: 1, midway: 2, idle: 3 };
  const entry = (stage: 'waiting' | 'accepted') => ({ progress: { stage } }) as InviteEntry;
  it('waits only while something is in progress, faster while someone is midway', () => {
    expect(passInterval({ watching: false, invites: [], joins: [] }, every)).toBeNull();
    expect(passInterval({ watching: true, invites: [], joins: [] }, every)).toBe(1);
    expect(passInterval({ watching: false, invites: [entry('waiting')], joins: [] }, every)).toBe(
      3,
    );
    expect(passInterval({ watching: false, invites: [entry('accepted')], joins: [] }, every)).toBe(
      2,
    );
    expect(passInterval({ watching: false, invites: [], joins: [{} as JoinEntry] }, every)).toBe(2);
  });
});
