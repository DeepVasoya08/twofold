import { describe, expect, it } from 'vitest';

import { FormError } from '@arcafold/core/errors';

import { batchText, deleteForeverTitle, deleteTitle } from './trash-text';

describe('batchText', () => {
  it('says what was done, and how many didn’t go through', () => {
    expect(batchText({ done: ['a', 'b'], failed: [] }, (p) => `${p} deleted`)).toBe(
      '2 photos deleted.',
    );
    expect(batchText({ done: ['a'], failed: ['b'] }, (p) => `${p} restored`)).toBe(
      '1 photo restored. 1 photo didn’t go through.',
    );
    expect(batchText({ done: ['a'], failed: ['b'] }, (p) => `${p} deleted`, 'file')).toBe(
      '1 file deleted. 1 file didn’t go through.',
    );
  });

  it('says why when nothing went through', () => {
    const error = new FormError('That photo isn’t in your vault anymore.');
    expect(batchText({ done: [], failed: ['a'], error }, (p) => p)).toBe(error.message);
  });
});

describe('titles', () => {
  it('asks about one photo, many, or everything', () => {
    expect(deleteTitle(1)).toBe('Delete this photo?');
    expect(deleteTitle(1200)).toBe('Delete 1,200 photos?');
    expect(deleteForeverTitle(3, false)).toBe('Delete 3 photos for good?');
    expect(deleteForeverTitle(3, true)).toBe('Empty Recently deleted?');
    expect(deleteTitle(1, 'file')).toBe('Delete this file?');
    expect(deleteTitle(2, 'file')).toBe('Delete 2 files?');
  });
});
