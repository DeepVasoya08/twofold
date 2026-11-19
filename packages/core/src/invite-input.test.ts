import { describe, expect, it } from 'vitest';

import {
  inviteLinkFor,
  isInviteCode,
  isLinkToken,
  normalizeInviteCode,
  parseInviteInput,
} from './invite-input';

describe('invite input', () => {
  it('normalizes typed codes', () => {
    expect(normalizeInviteCode('two 7kq4 m9xd')).toBe('TWO-7KQ4-M9XD');
    expect(normalizeInviteCode('7KQ4M9XD')).toBe('TWO-7KQ4-M9XD');
  });

  it('only accepts the full code format, without misreadable letters', () => {
    expect(isInviteCode('TWO-7KQ4-M9XD')).toBe(true);
    expect(isInviteCode('TWO-7KQ4-M9X0')).toBe(false);
    expect(isInviteCode(normalizeInviteCode('7KQ4'))).toBe(false);
  });

  it('takes a typed code or a pasted invite link', () => {
    // A plain pattern, so it isn't mistaken for a secret.
    const token = 'A'.repeat(22);
    expect(isLinkToken(token)).toBe(true);
    expect(parseInviteInput(' two-7kq4-m9xd ')).toBe('TWO-7KQ4-M9XD');
    expect(parseInviteInput(`https://arcafold.example/join/${token}`)).toBe(token);
    expect(parseInviteInput(`Join me: arcafold.example/join/${token}?x=1`)).toBe(token);
    expect(parseInviteInput('https://arcafold.example/join/short')).toBeNull();
    expect(parseInviteInput('TWO-7KQ4')).toBeNull();
    expect(parseInviteInput('')).toBeNull();
  });

  it('makes the link to send', () => {
    expect(inviteLinkFor('https://arcafold.com', 'abc')).toBe('https://arcafold.com/join/abc');
  });
});
