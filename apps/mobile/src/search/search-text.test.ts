import { describe, expect, it } from 'vitest';

import { namedPeople, searchStatus } from './search-text';

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

describe('namedPeople', () => {
  const group = (name: string | undefined, photos: number, hidden = false) => ({
    person: name === undefined ? null : { name, hidden },
    photoIds: Array.from({ length: photos }, (_, i) => `p${String(i)}`),
  });

  it('keeps named, shown people, most photos first, up to the limit', () => {
    const groups = [
      group('Sam', 3),
      group(undefined, 50),
      group('Riya', 9),
      group('Old', 20, true),
      group('  ', 4),
      group('Dev', 1),
    ];
    expect(namedPeople(groups).map((each) => each.name)).toEqual(['Riya', 'Sam', 'Dev']);
    expect(namedPeople(groups, 2).map((each) => each.name)).toEqual(['Riya', 'Sam']);
  });
});
