import { describe, expect, it } from 'vitest';

import { isDraft } from './details';

const complete = {
  operator: 'Example Ltd',
  contactEmail: 'privacy@example.com',
  jurisdiction: 'England and Wales',
  minimumAge: 16,
  effectiveDate: '1 November 2026',
};

describe('isDraft', () => {
  it('is a draft while any detail is missing', () => {
    expect(isDraft({ ...complete, contactEmail: null })).toBe(true);
  });

  it('is final once every detail is filled in', () => {
    expect(isDraft(complete)).toBe(false);
  });
});
