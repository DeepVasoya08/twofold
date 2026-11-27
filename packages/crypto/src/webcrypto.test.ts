import { describe, expect, it } from 'vitest';

import {
  constantTimeEqual,
  decoySalt,
  emailCodeMatches,
  emailCodeScope,
  emailCodeTag,
  fromBase64Url,
  loginVerifier,
  newEmailCode,
  newSessionToken,
  sessionTokenHash,
  toBase64Url,
  webhookSignature,
  webhookSignatureMatches,
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

describe('email codes', () => {
  const secret = 'a'.repeat(44);

  it('makes six-digit codes that vary', () => {
    const codes = new Set(Array.from({ length: 50 }, () => newEmailCode()));
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(codes.size).toBeGreaterThan(40);
  });

  it('uses every digit in every position', () => {
    const seen = Array.from({ length: 6 }, () => new Set<string>());
    for (let i = 0; i < 400; i++) {
      const code = newEmailCode();
      for (let position = 0; position < code.length; position++) {
        seen[position]?.add(code.charAt(position));
      }
    }
    for (const digits of seen) expect(digits.size).toBe(10);
  });

  it('accepts the right code for the same scope and address', async () => {
    const scope = await emailCodeScope(secret, 'verify', 'account-1');
    const tag = await emailCodeTag(secret, scope, 'sam@example.com', '123456');
    expect(await emailCodeMatches(secret, scope, 'sam@example.com', '123456', tag)).toBe(true);
  });

  it('refuses a wrong code, another address, another scope or another secret', async () => {
    const scope = await emailCodeScope(secret, 'verify', 'account-1');
    const other = await emailCodeScope(secret, 'verify', 'account-2');
    const tag = await emailCodeTag(secret, scope, 'sam@example.com', '123456');
    expect(await emailCodeMatches(secret, scope, 'sam@example.com', '123457', tag)).toBe(false);
    expect(await emailCodeMatches(secret, scope, 'kim@example.com', '123456', tag)).toBe(false);
    expect(await emailCodeMatches(secret, other, 'sam@example.com', '123456', tag)).toBe(false);
    expect(await emailCodeMatches('b'.repeat(44), scope, 'sam@example.com', '123456', tag)).toBe(
      false,
    );
  });

  it('refuses a tampered tag', async () => {
    const scope = await emailCodeScope(secret, 'verify', 'account-1');
    const tag = await emailCodeTag(secret, scope, 'sam@example.com', '123456');
    const flipped = `${tag.slice(0, -2)}${tag.endsWith('AA') ? 'BA' : 'AA'}`;
    expect(await emailCodeMatches(secret, scope, 'sam@example.com', '123456', flipped)).toBe(false);
    expect(await emailCodeMatches(secret, scope, 'sam@example.com', '123456', 'not+base64')).toBe(
      false,
    );
  });

  it('keeps scopes apart and never shows what they were made from', async () => {
    const a = await emailCodeScope(secret, 'verify', 'account-1');
    expect(a).not.toContain('account-1');
    expect(a).not.toBe(await emailCodeScope(secret, 'signup', 'account-1'));
  });

  it('refuses a short secret', async () => {
    await expect(emailCodeScope('short', 'verify', 'x')).rejects.toThrow();
  });
});

describe('decoySalt', () => {
  const secret = 'a'.repeat(44);

  it('is the same for one email, differs between emails and secrets, and has the salt size', async () => {
    const first = await decoySalt(secret, 'kim@example.com', 16);
    expect(await decoySalt(secret, 'kim@example.com', 16)).toBe(first);
    expect(await decoySalt(secret, 'sam@example.com', 16)).not.toBe(first);
    expect(await decoySalt('b'.repeat(44), 'kim@example.com', 16)).not.toBe(first);
    expect(fromBase64Url(first)).toHaveLength(16);
  });
});

describe('webhook signatures', () => {
  const SECRET = 'test-webhook-secret-123';
  const BODY = '{"event":"subscription.charged"}';
  // Worked out separately with Python's hmac module.
  const KNOWN = '16cd65108bf4f8b620fae362ed98b487e7f1e23f8c0128ebf0f11baec8ae6112';

  it('matches a known HMAC-SHA256 in lowercase hex', async () => {
    expect(await webhookSignature(SECRET, BODY)).toBe(KNOWN);
    expect(await webhookSignatureMatches(SECRET, BODY, KNOWN)).toBe(true);
  });

  it('rejects a wrong secret', async () => {
    expect(await webhookSignatureMatches('another-webhook-secret-1', BODY, KNOWN)).toBe(false);
  });

  it('rejects a changed body, even by one space', async () => {
    expect(await webhookSignatureMatches(SECRET, BODY.replace(':', ': '), KNOWN)).toBe(false);
    expect(await webhookSignatureMatches(SECRET, `${BODY}\n`, KNOWN)).toBe(false);
  });

  it('rejects a changed, short, uppercase or missing signature', async () => {
    const flipped = `${KNOWN.slice(0, -1)}${KNOWN.endsWith('2') ? '3' : '2'}`;
    expect(await webhookSignatureMatches(SECRET, BODY, flipped)).toBe(false);
    expect(await webhookSignatureMatches(SECRET, BODY, KNOWN.slice(2))).toBe(false);
    expect(await webhookSignatureMatches(SECRET, BODY, KNOWN.toUpperCase())).toBe(false);
    expect(await webhookSignatureMatches(SECRET, BODY, '')).toBe(false);
  });

  it('refuses a secret too short to be safe', async () => {
    const short = 'short';
    expect(await webhookSignatureMatches(short, BODY, await webhookSignature(short, BODY))).toBe(
      false,
    );
  });
});
