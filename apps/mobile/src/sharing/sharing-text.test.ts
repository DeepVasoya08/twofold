import { describe, expect, it } from 'vitest';

import type { Photo } from '@arcafold/core/library/model';
import type { InviteEntry, JoinEntry } from '@arcafold/core/sharing-pass';

import {
  accessChangedText,
  inviteMessage,
  inviteStatus,
  joinStatus,
  shareAccessLabels,
  shareIntro,
  sharedThing,
  sharedWithLine,
  spaceName,
  untilText,
} from './sharing-text';
import type { ShareTarget } from './sharing-text';

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

describe('sharing a folder or a file', () => {
  const target = (kind: ShareTarget['kind']): ShareTarget => ({ id: 'row', title: 'Taxes', kind });

  it('says what each kind lets people do', () => {
    expect(shareAccessLabels('album').edit.title).toBe('Add and edit');
    expect(shareAccessLabels('folder').edit.detail).toContain('rename, move and delete');
    expect(shareAccessLabels('file').edit.title).toBe('Can edit');
    expect(shareIntro('file')).toContain('this file');
    expect(accessChangedText('Bob', target('album'), 'edit')).toBe('Bob can add to “Taxes” now');
    expect(accessChangedText('Bob', target('folder'), 'edit')).toBe('Bob can edit “Taxes” now');
    expect(accessChangedText('Bob', target('file'), 'view')).toBe('Bob can only view “Taxes” now');
  });

  it('finds what an invite shares: your album, folder or file, never someone else’s', () => {
    const photo = (extra: Partial<Photo>): Photo => ({
      id: 'p',
      src: '',
      width: 1,
      height: 1,
      takenAt: '2026-01-01T00:00:00Z',
      addedBy: 'me',
      favorite: false,
      albumIds: [],
      ...extra,
    });
    const albums = [
      { id: 'trip', title: 'Trip' },
      { id: 'theirs', title: 'Theirs', library: 'Sam' },
    ];
    const folders = [
      { id: 'taxes', name: 'Taxes', sharedWith: ['Kim'] },
      { id: 'gone', name: 'Gone', deletedAt: '2026-11-01T00:00:00Z' },
    ];
    const photos = [photo({ id: 'lease', shareId: 'lease-row', sharedWith: ['Bob'] })];
    expect(sharedThing('trip', albums, folders, photos)?.id).toBe('trip');
    expect(sharedThing('theirs', albums, folders, photos)).toBeUndefined();
    expect(sharedThing('taxes', albums, folders, photos)).toMatchObject({ sharedWith: ['Kim'] });
    expect(sharedThing('gone', albums, folders, photos)).toBeUndefined();
    expect(sharedThing('lease-row', albums, folders, photos)).toEqual({
      id: 'lease-row',
      sharedWith: ['Bob'],
    });
  });
});
