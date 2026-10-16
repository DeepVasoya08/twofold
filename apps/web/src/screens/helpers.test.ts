import { describe, expect, it } from 'vitest';

import { albumIdFromTitle } from './Albums';
import { isInviteCode, normalizeInviteCode } from './Share';
import { countWords } from './Recover';
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

describe('albumIdFromTitle', () => {
  it('slugifies and avoids collisions', () => {
    expect(albumIdFromTitle('Paris, 2027!', [])).toBe('paris-2027');
    expect(albumIdFromTitle('Paris', ['paris', 'paris-2'])).toBe('paris-3');
    expect(albumIdFromTitle('✨', [])).toBe('album');
  });
});

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords('  maple   river\nlantern ')).toBe(3);
    expect(countWords('')).toBe(0);
  });
});
