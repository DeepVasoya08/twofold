import { describe, expect, it } from 'vitest';

import { albumChangeText, chosenText, photoCount } from './album-text';

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
