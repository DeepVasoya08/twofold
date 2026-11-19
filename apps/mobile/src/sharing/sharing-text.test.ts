import { describe, expect, it } from 'vitest';

import type { InviteEntry, JoinEntry } from '@arcafold/core/sharing-pass';

import {
  inviteMessage,
  inviteStatus,
  joinStatus,
  sharedWithLine,
  spaceName,
  untilText,
} from './sharing-text';

const invite = (progress: InviteEntry['progress']) => ({ progress }) as InviteEntry;
const join = (progress: JoinEntry['progress']) => ({ progress }) as JoinEntry;

describe('sharing text', () => {
  it('names the space', () => {
    expect(spaceName('main')).toBe('library');
    expect(spaceName('private')).toBe('private space');
  });

  it('says how far an invite has got', () => {
    expect(inviteStatus(invite({ stage: 'waiting' }))).toBe('Not accepted yet');
    expect(inviteStatus(invite({ stage: 'accepted' }))).toBe('Accepted, waiting for them');
    expect(
      inviteStatus(invite({ stage: 'confirm', name: 'Sam', phrase: [], joinerKey: 'k' })),
    ).toBe('Sam is waiting for you to check the words');
  });

  it('says what a joiner is waiting for', () => {
    expect(joinStatus(undefined)).toMatch(/Waiting for them to open Arcafold/);
    expect(joinStatus(join({ stage: 'check', name: 'Sam', phrase: [] }))).toMatch(
      /^Waiting for Sam to confirm/,
    );
  });

  it('says until when an invite works', () => {
    expect(untilText(Date.UTC(2026, 10, 25, 12))).toBe('until Nov 25');
  });

  it('puts the link and the code in the message', () => {
    const text = inviteMessage('Ana', 'https://arcafold.com/join/x', 'TWO-AAAA-BBBB');
    expect(text).toContain('https://arcafold.com/join/x');
    expect(text).toContain('TWO-AAAA-BBBB');
    expect(text.startsWith('Ana invited you')).toBe(true);
  });

  it('lists who the library is shared with', () => {
    expect(sharedWithLine([])).toBe('Not shared with anyone.');
    expect(sharedWithLine([{ name: 'Sam' }])).toBe('Shared with Sam.');
    expect(sharedWithLine([{ name: 'Sam' }, { name: 'Ana' }, { name: 'Raj' }])).toBe(
      'Shared with Sam, Ana and Raj.',
    );
  });
});
