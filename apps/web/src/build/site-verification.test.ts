import { describe, expect, it } from 'vitest';

import { siteVerificationTag } from './site-verification';

describe('siteVerificationTag', () => {
  it('makes the meta tag Google looks for', () => {
    expect(siteVerificationTag(' abcDEF_123-xyz7890 ')).toBe(
      '<meta name="google-site-verification" content="abcDEF_123-xyz7890" />',
    );
  });

  it('leaves it out when unset or not a token', () => {
    expect(siteVerificationTag(undefined)).toBeNull();
    expect(siteVerificationTag('')).toBeNull();
    expect(siteVerificationTag('"><script>alert(1)</script>')).toBeNull();
    expect(
      siteVerificationTag('<meta name="google-site-verification" content="abc" />'),
    ).toBeNull();
  });
});
