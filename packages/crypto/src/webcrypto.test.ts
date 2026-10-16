import { describe, expect, it } from 'vitest';

import {
  constantTimeEqual,
  fromBase64Url,
  loginVerifier,
  newSessionToken,
  sessionTokenHash,
  toBase64Url,
} from './webcrypto';

describe('base64url', () => {
  it('round-trips every length', () => {
    for (let length = 0; length < 40; length++) {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });

  it('uses the URL-safe alphabet without padding', () => {
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
  });

  it('rejects padding, foreign characters and non-canonical input', () => {
    expect(fromBase64Url('-_8=')).toBeNull();
    expect(fromBase64Url('+/8')).toBeNull();
    expect(fromBase64Url('A')).toBeNull();
    expect(fromBase64Url('-_9')).toBeNull();
  });
});

describe('constantTimeEqual', () => {
  it('compares contents and lengths', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1]))).toBe(false);
  });
});

describe('session tokens', () => {
  it('are 256-bit and hash deterministically', async () => {
    const token = newSessionToken();
    expect(fromBase64Url(token)).toHaveLength(32);
    expect(newSessionToken()).not.toBe(token);
    expect(await sessionTokenHash(token)).toBe(await sessionTokenHash(token));
    expect(await sessionTokenHash(token)).not.toBe(token);
  });
});

describe('loginVerifier', () => {
  it('is SHA-256', async () => {
    const verifier = await loginVerifier(new TextEncoder().encode('abc'));
    expect(toBase64Url(verifier)).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });
});
