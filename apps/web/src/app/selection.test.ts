import { describe, expect, it } from 'vitest';

import { ApiError } from '@arcafold/core/api';
import { allSelected, batchMessage, withMany } from './selection';

describe('withMany', () => {
  it('adds or takes out every id, leaving the original alone', () => {
    const start = new Set(['a']);
    expect([...withMany(start, ['b', 'c'], true)]).toEqual(['a', 'b', 'c']);
    expect([...withMany(start, ['a', 'z'], false)]).toEqual([]);
    expect([...start]).toEqual(['a']);
  });
});

describe('allSelected', () => {
  it('needs every id, and at least one', () => {
    const selected = new Set(['a', 'b']);
    expect(allSelected(selected, ['a', 'b'])).toBe(true);
    expect(allSelected(selected, ['a', 'c'])).toBe(false);
    expect(allSelected(selected, [])).toBe(false);
  });
});

describe('batchMessage', () => {
  const deleted = (photos: string) => `${photos} deleted`;

  it('counts what went through', () => {
    expect(batchMessage({ done: ['a', 'b'], failed: [] }, deleted)).toBe('2 photos deleted');
    expect(batchMessage({ done: ['a'], failed: [] }, deleted)).toBe('1 photo deleted');
  });

  it('says how many didn’t', () => {
    expect(batchMessage({ done: ['a', 'b'], failed: ['c'], error: new Error('x') }, deleted)).toBe(
      '2 photos deleted. 1 photo didn’t go through.',
    );
  });

  it('gives the reason when nothing went through', () => {
    const error = new ApiError(413, 'Your storage is full.');
    expect(batchMessage({ done: [], failed: ['a'], error }, deleted)).toBe('Your storage is full.');
    expect(batchMessage({ done: [], failed: ['a'], error: new Error('boom') }, deleted)).toBe(
      'Something went wrong. Try again.',
    );
  });
});
