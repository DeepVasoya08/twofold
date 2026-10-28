import { describe, expect, it } from 'vitest';

import { albumsInTab } from './Albums';
import { filterByOwner } from './Gallery';
import { aboutPerson } from './People';
import { sharedWithLine } from './Settings';
import { isInviteCode, normalizeInviteCode, parseInviteInput } from './JoinCode';
import { countWords } from './Recover';
import { notLookedAtLine, notReadyLine } from './Search';
import { validateSignUp } from './SignUp';

describe('invite codes', () => {
  it('normalizes typed codes', () => {
    expect(normalizeInviteCode('two 7kq4 m9xd')).toBe('TWO-7KQ4-M9XD');
    expect(normalizeInviteCode('7KQ4M9XD')).toBe('TWO-7KQ4-M9XD');
  });

  it('only accepts the full format', () => {
    expect(isInviteCode('TWO-7KQ4-M9XD')).toBe(true);
    expect(isInviteCode(normalizeInviteCode('7KQ4'))).toBe(false);
  });

  it('takes a typed code or a pasted invite link', () => {
    expect(parseInviteInput(' two-7kq4-m9xd ')).toBe('TWO-7KQ4-M9XD');
    // A plain pattern, so it isn't mistaken for a secret.
    const token = 'A'.repeat(22);
    expect(parseInviteInput(`https://twofold.example/join/${token}`)).toBe(token);
    expect(parseInviteInput(`twofold.example/join/${token}?x=1`)).toBe(token);
    expect(parseInviteInput('https://twofold.example/join/short')).toBeNull();
    expect(parseInviteInput('TWO-7KQ4')).toBeNull();
    expect(parseInviteInput('')).toBeNull();
  });
});

describe('filterByOwner', () => {
  const base = {
    src: '',
    width: 1,
    height: 1,
    takenAt: '2026-10-01T00:00:00Z',
    addedBy: 'me' as const,
    favorite: false,
    albumIds: [],
  };
  const mine = { ...base, id: 'mine' };
  const theirs = { ...base, id: 'theirs', library: 'Deep', addedBy: 'contact' as const };

  it('splits the timeline into yours and what was shared with you', () => {
    expect(filterByOwner([mine, theirs], 'all')).toEqual([mine, theirs]);
    expect(filterByOwner([mine, theirs], 'mine')).toEqual([mine]);
    expect(filterByOwner([mine, theirs], 'shared')).toEqual([theirs]);
  });
});

describe('sharedWithLine', () => {
  it('names everyone with their permission', () => {
    expect(
      sharedWithLine([
        { name: 'invited', access: 'view' },
        { name: 'Mira', access: 'edit' },
      ]),
    ).toBe('invited (View only), Mira (Add and edit)');
  });
});

describe('validateSignUp', () => {
  const valid = {
    name: 'Deepu',
    email: 'deepu@example.com',
    password: 'Correct-Horse-Battery-9',
    confirm: 'Correct-Horse-Battery-9',
  };

  it('accepts a valid form', () => {
    expect(validateSignUp(valid)).toEqual({});
  });

  it('flags each field', () => {
    expect(
      Object.keys(validateSignUp({ name: ' ', email: 'x', password: 'short', confirm: 'other' })),
    ).toEqual(['name', 'email', 'password', 'confirm']);
    expect(
      validateSignUp({ ...valid, password: 'aaaaaaaaaaaaaaaa', confirm: 'aaaaaaaaaaaaaaaa' }),
    ).toHaveProperty('password');
  });
});

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords('  maple   river\nlantern ')).toBe(3);
    expect(countWords('')).toBe(0);
  });
});

describe('albumsInTab', () => {
  const mine = { id: 'm', title: 'Mine' };
  const sharedByMe = { id: 'b', title: 'Trip', sharedWith: ['Mira'] };
  const fromLibrary = { id: 'l', title: 'Theirs', library: 'Mira' };
  const sharedWithMe = { id: 's', title: 'Gift', library: 'Sam', sharedAlbum: true };
  const all = [mine, sharedByMe, fromLibrary, sharedWithMe];

  it('shows everything under All albums', () => {
    expect(albumsInTab(all, 'all')).toEqual(all);
  });

  it('shows other people’s albums under Shared with me', () => {
    expect(albumsInTab(all, 'with-me')).toEqual([fromLibrary, sharedWithMe]);
  });

  it('shows your albums shared with someone under Shared by me', () => {
    expect(albumsInTab(all, 'by-me')).toEqual([sharedByMe]);
    expect(albumsInTab([{ ...sharedByMe, sharedWith: [] }], 'by-me')).toEqual([]);
  });
});

describe('aboutPerson', () => {
  const group = (me: boolean, labels: ('friends' | 'family' | 'work')[]) => ({
    id: 'p',
    person: { id: 'p', name: 'Ada', faces: [], rejected: [], hidden: false, me, labels },
    faces: [],
    photoIds: [],
  });

  it('puts "You" and labels before the photo count', () => {
    expect(aboutPerson(group(true, ['family']), '3 photos')).toBe('You · Family · 3 photos');
    expect(aboutPerson(group(false, []), '3 photos')).toBe('3 photos');
    expect(aboutPerson({ id: 'g', person: null, faces: [], photoIds: [] }, '1 photo')).toBe(
      '1 photo',
    );
  });
});

describe('search notes', () => {
  it('say which photos haven’t been looked at yet', () => {
    expect(notReadyLine(1)).toBe('1 photo isn’t ready to search by what’s in it yet.');
    expect(notLookedAtLine({ photo: true, words: ['Biscuit'] })).toMatch(
      /^This photo hasn’t been looked at yet\./,
    );
    expect(notLookedAtLine({ photo: false, words: ['Biscuit'] })).toMatch(
      /^The photos you taught “Biscuit” with haven’t/,
    );
    expect(notLookedAtLine({ photo: false, words: ['Biscuit', 'Kite', 'the cabin'] })).toMatch(
      /taught “Biscuit”, “Kite” and “the cabin” with/,
    );
  });
});
