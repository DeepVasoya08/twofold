import { describe, expect, it } from 'vitest';

import { isValidEmail, passwordStrength } from './password';

describe('passwordStrength', () => {
  it('rejects short passwords', () => {
    expect(passwordStrength('Abc!1234')).toEqual({ score: 0, label: 'Too short' });
  });

  it('treats repetitive passwords as weak', () => {
    expect(passwordStrength('aaaaaaaaaaaaaaaa').score).toBe(1);
  });

  it('rewards length and variety', () => {
    expect(passwordStrength('correcthorsebattery').score).toBeGreaterThanOrEqual(2);
    expect(passwordStrength('Correct-Horse-Battery-9').score).toBe(4);
  });
});

describe('isValidEmail', () => {
  it('accepts normal addresses and rejects junk', () => {
    expect(isValidEmail(' deepu@example.com ')).toBe(true);
    expect(isValidEmail('deepu@example')).toBe(false);
    expect(isValidEmail('no spaces@example.com')).toBe(false);
  });
});
