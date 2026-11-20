import { describe, expect, it } from 'vitest';

import { searchStatus } from './search-text';

describe('searchStatus', () => {
  it('says while the index loads, or when it couldn’t', () => {
    expect(searchStatus({ index: 'loading', lookedAt: { done: 0, total: 3 } })).toMatch(/ready/);
    expect(searchStatus({ index: 'failed', lookedAt: { done: 0, total: 3 } })).toMatch(
      /Couldn’t load search/,
    );
  });

  it('says where photos are looked at when none have been', () => {
    expect(searchStatus({ index: 'ready', lookedAt: { done: 0, total: 3 } })).toMatch(
      /Smart search on in Settings/,
    );
  });

  it('says nothing once photos have been looked at, or with no photos', () => {
    expect(searchStatus({ index: 'ready', lookedAt: { done: 1, total: 3 } })).toBeNull();
    expect(searchStatus({ index: 'ready', lookedAt: { done: 0, total: 0 } })).toBeNull();
  });
});
