import { describe, expect, it } from 'vitest';

import {
  formatDateRange,
  formatLastActive,
  groupByMonth,
  initials,
  photosAndFiles,
  pluralize,
} from './format';
import type { Photo } from '@arcafold/core/library/model';

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

describe('formatDateRange', () => {
  it('handles empty, single-day, same-month, same-year and cross-year ranges', () => {
    expect(formatDateRange([])).toBeNull();
    expect(formatDateRange(['2026-07-06T10:00:00Z', '2026-07-06T18:00:00Z'])).toBe('Jul 6, 2026');
    expect(formatDateRange(['2026-07-21T10:00:00Z', '2026-07-06T10:00:00Z'])).toBe(
      'Jul 6 – 21, 2026',
    );
    expect(formatDateRange(['2026-05-11T10:00:00Z', '2026-10-14T10:00:00Z'])).toBe(
      'May 11 – Oct 14, 2026',
    );
    expect(formatDateRange(['2025-11-02T10:00:00Z', '2026-02-14T10:00:00Z'])).toBe(
      'Nov 2, 2025 – Feb 14, 2026',
    );
  });
});

describe('small helpers', () => {
  it('pluralizes', () => {
    expect(pluralize(1, 'photo')).toBe('1 photo');
    expect(pluralize(1200, 'photo')).toBe('1,200 photos');
  });

  it('makes initials', () => {
    expect(initials('Deepu')).toBe('D');
    expect(initials('mira  rao kapoor')).toBe('MR');
  });
});

describe('formatLastActive', () => {
  const hour = 60 * 60 * 1000;
  const now = Date.UTC(2026, 9, 19, 12, 30);

  it('reads naturally at each scale', () => {
    expect(formatLastActive(now - 20 * 60 * 1000, now)).toBe('Active recently');
    expect(formatLastActive(now - hour, now)).toBe('Active 1 hour ago');
    expect(formatLastActive(now - 5 * hour, now)).toBe('Active 5 hours ago');
    expect(formatLastActive(now - 30 * hour, now)).toBe('Active yesterday');
    expect(formatLastActive(now - 4 * 24 * hour, now)).toBe('Active 4 days ago');
    expect(formatLastActive(Date.UTC(2026, 6, 2), now)).toBe('Active Jul 2, 2026');
  });
});

describe('photosAndFiles', () => {
  it('counts photos and files apart', () => {
    expect(photosAndFiles([{}, {}])).toBe('2 photos');
    expect(photosAndFiles([{ file: {} }])).toBe('1 file');
    expect(photosAndFiles([{}, { file: {} }, { file: {} }])).toBe('1 photo and 2 files');
  });
});
