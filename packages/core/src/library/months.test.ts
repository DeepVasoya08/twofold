import { describe, expect, it } from 'vitest';

import type { Photo } from './model';
import { groupByMonth } from './months';

function photo(id: string, takenAt: string, location?: string): Photo {
  return {
    id,
    src: '',
    width: 1,
    height: 1,
    takenAt,
    addedBy: 'me',
    favorite: false,
    albumIds: [],
    ...(location ? { location } : {}),
  };
}

describe('groupByMonth', () => {
  it('groups newest month first with unique locations', () => {
    const groups = groupByMonth([
      photo('a', '2026-01-05T10:00:00Z', 'Goa'),
      photo('b', '2026-03-02T10:00:00Z', 'Kyoto'),
      photo('c', '2026-01-20T10:00:00Z', 'Goa'),
      photo('d', '2026-01-21T10:00:00Z', 'Pune'),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['March 2026', 'January 2026']);
    expect(groups[1]?.photos.map((p) => p.id)).toEqual(['d', 'c', 'a']);
    expect(groups[1]?.locations).toEqual(['Pune', 'Goa']);
  });

  it('returns nothing for no photos', () => {
    expect(groupByMonth([])).toEqual([]);
  });
});
