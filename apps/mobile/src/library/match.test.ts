import { describe, expect, it } from 'vitest';

import { filterByName, matchesQuery } from './match';

describe('matchesQuery', () => {
  it('matches everything when nothing is typed', () => {
    expect(matchesQuery('Beach 2024', '')).toBe(true);
    expect(matchesQuery('Beach 2024', '   ')).toBe(true);
  });

  it('ignores case and accents', () => {
    expect(matchesQuery('Zoë’s birthday', 'zoe')).toBe(true);
    expect(matchesQuery('cafe', 'CAFÉ')).toBe(true);
  });

  it('needs every word, in any order', () => {
    expect(matchesQuery('Lisbon trip 2023', 'trip lisbon')).toBe(true);
    expect(matchesQuery('Lisbon trip 2023', 'lisbon porto')).toBe(false);
  });

  it('matches part of a word', () => {
    expect(matchesQuery('Tax return.pdf', 'retu')).toBe(true);
    expect(matchesQuery('Tax return.pdf', 'invoice')).toBe(false);
  });
});

describe('filterByName', () => {
  const albums = [{ title: 'Beach' }, { title: 'Birthday' }, { title: 'Snow' }];

  it('keeps the order and drops what does not match', () => {
    expect(filterByName(albums, 'b', (album) => album.title)).toEqual([
      { title: 'Beach' },
      { title: 'Birthday' },
    ]);
  });

  it('returns the same list when nothing is typed', () => {
    expect(filterByName(albums, ' ', (album) => album.title)).toBe(albums);
  });
});
