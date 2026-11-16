import { describe, expect, it } from 'vitest';

import { lastActiveText, shortDay } from './devices';

const HOUR = 60 * 60 * 1000;
const NOW = new Date(2026, 10, 16, 12).getTime();

describe('lastActiveText', () => {
  it('says how long ago, in words', () => {
    expect(lastActiveText(NOW - 10 * 60 * 1000, NOW)).toBe('Active recently');
    expect(lastActiveText(NOW - HOUR, NOW)).toBe('Active 1 hour ago');
    expect(lastActiveText(NOW - 5 * HOUR, NOW)).toBe('Active 5 hours ago');
    expect(lastActiveText(NOW - 24 * HOUR, NOW)).toBe('Active yesterday');
    expect(lastActiveText(NOW - 72 * HOUR, NOW)).toBe('Active 3 days ago');
  });

  it('gives the day for anything older than a month', () => {
    expect(lastActiveText(new Date(2026, 8, 2).getTime(), NOW)).toBe('Active Sep 2, 2026');
    expect(shortDay(NOW)).toBe('Nov 16, 2026');
  });
});
