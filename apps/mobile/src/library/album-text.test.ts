import { describe, expect, it } from 'vitest';

import { albumChangeText, chosenText, dateSpan, favoriteText, photoCount } from './album-text';

describe('photoCount', () => {
  it('counts photos, or says the album is empty', () => {
    expect(photoCount(0)).toBe('Empty');
    expect(photoCount(1)).toBe('1 photo');
    expect(photoCount(1200)).toBe('1,200 photos');
  });
});

describe('albumChangeText', () => {
  it('says what went in or came out', () => {
    expect(albumChangeText({ done: ['a'], failed: [] }, 'Goa', true)).toBe(
      'Added 1 photo to “Goa”.',
    );
    expect(albumChangeText({ done: ['a', 'b'], failed: [] }, 'Goa', false)).toBe(
      'Removed 2 photos from “Goa”.',
    );
  });

  it('says when some or all of them failed', () => {
    expect(albumChangeText({ done: ['a'], failed: ['b'] }, 'Goa', true)).toBe(
      'Added 1 photo to “Goa”. 1 couldn’t be added; try those again.',
    );
    expect(albumChangeText({ done: [], failed: ['b'] }, 'Goa', true)).toBe(
      'The photos couldn’t be added. Try again.',
    );
  });
});

describe('chosenText', () => {
  it('counts the photos chosen', () => {
    expect(chosenText(0)).toBe('Choose photos');
    expect(chosenText(1)).toBe('1 chosen');
    expect(chosenText(3)).toBe('3 chosen');
  });
});

describe('dateSpan', () => {
  it('says one day, a span in a month, across months and across years', () => {
    expect(dateSpan([])).toBeNull();
    expect(dateSpan(['2026-11-22T10:00:00Z', '2026-11-22T18:00:00Z'])).toBe('Nov 22, 2026');
    expect(dateSpan(['2026-11-23T10:00:00Z', '2026-11-20T08:00:00Z'])).toBe('Nov 20 – 23, 2026');
    expect(dateSpan(['2026-10-30T10:00:00Z', '2026-11-02T08:00:00Z'])).toBe('Oct 30 – Nov 2, 2026');
    expect(dateSpan(['2025-12-30T10:00:00Z', '2026-01-02T08:00:00Z'])).toBe(
      'Dec 30, 2025 – Jan 2, 2026',
    );
  });

  it('skips dates it cannot read', () => {
    expect(dateSpan(['not a date', '2026-11-22T10:00:00Z'])).toBe('Nov 22, 2026');
  });
});

describe('favoriteText', () => {
  it('says how many were added or removed', () => {
    expect(favoriteText({ done: ['a'], failed: [] }, true)).toBe('Added 1 photo to favorites.');
    expect(favoriteText({ done: ['a', 'b'], failed: [] }, false)).toBe(
      'Removed 2 photos from favorites.',
    );
  });

  it('says when some or all didn’t go through', () => {
    expect(favoriteText({ done: ['a'], failed: ['b'] }, true)).toBe(
      'Added 1 photo to favorites. 1 didn’t go through; try those again.',
    );
    expect(favoriteText({ done: [], failed: ['a'] }, false)).toBe(
      'The photos couldn’t be removed from favorites. Try again.',
    );
  });
});
