import { describe, expect, it } from 'vitest';

import { newSpace } from '@arcafold/crypto';

import { advancePending, grantedText, passInterval } from './sharing-pass';
import type { InviteEntry, JoinEntry } from './sharing-pass';
import { cancelInvite, confirmInvite, listJoined, startInvite, startJoin } from './sharing';
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
    let alice = await advancePending(w.alice, 'Alice', w.apis, new Set(), NONE);
    expect(alice.invites.map((entry) => entry.progress.stage)).toEqual(['waiting']);

    await startJoin(invite.code, w.bob, w.apis);
    alice = await advancePending(w.alice, 'Alice', w.apis, new Set(), NONE);
    expect(alice.invites[0]?.progress.stage).toBe('accepted');
    let bob = await advancePending(w.bob, 'Bob', w.apis, new Set(), NONE);
    expect(bob.joins[0]?.progress.stage).toBe('check');

    alice = await advancePending(w.alice, 'Alice', w.apis, new Set(), NONE);
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

    bob = await advancePending(w.bob, 'Bob', w.apis, new Set(), NONE);
    expect(bob.granted).toEqual([{ joinId: expect.any(String), name: 'Alice', album: false }]);
    expect(bob.joins).toEqual([]);
    expect(await listJoined(w.bob, w.apis.space)).toHaveLength(1);
  });

  it('leaves alone what was settled on this device meanwhile', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, w.apis);
    const result = await advancePending(w.alice, 'Alice', w.apis, new Set([invite.id]), NONE);
    expect(result.invites).toEqual([]);
  });

  it('reports a cancelled invite as gone to the joiner', async () => {
    const w = await world();
    const invite = await startInvite(w.alice, null, w.apis);
    const join = await startJoin(invite.link, w.bob, w.apis);
    await cancelInvite(invite, w.alice, w.apis);
    const bob = await advancePending(w.bob, 'Bob', w.apis, new Set(), NONE);
    expect(bob.goneJoins.map((each) => each.id)).toEqual([join.id]);
  });
});

describe('grantedText', () => {
  it('says what was shared', () => {
    expect(grantedText({ name: 'Sam', album: true })).toBe('Sam shared an album with you');
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
