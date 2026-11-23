import { describe, expect, it } from 'vitest';

import { FormError } from '@arcafold/core/errors';

import { saveOutcome, savingText } from './save-text';

describe('savingText', () => {
  it('counts the photo being saved', () => {
    expect(savingText({ done: 0, total: 1, bytesDone: 0, bytesTotal: 0 })).toBe(
      'Saving to your phone…',
    );
    expect(savingText({ done: 2, total: 10, bytesDone: 0, bytesTotal: 0 })).toBe(
      'Saving 3 of 10 to your phone…',
    );
    expect(savingText({ done: 10, total: 10, bytesDone: 0, bytesTotal: 0 })).toBe(
      'Saving 10 of 10 to your phone…',
    );
  });
});

describe('saveOutcome', () => {
  it('says where the copies went, and how many didn’t', () => {
    expect(saveOutcome({ state: 'done', result: { done: ['a', 'b'], failed: [] } })).toBe(
      '2 photos saved to Pictures/Arcafold.',
    );
    expect(saveOutcome({ state: 'done', result: { done: ['a'], failed: ['b'] } })).toBe(
      '1 photo saved to Pictures/Arcafold. 1 photo didn’t go through.',
    );
  });

  it('says why when none were saved', () => {
    const error = new FormError('No room left on this phone.');
    expect(saveOutcome({ state: 'done', result: { done: [], failed: ['a'], error } })).toBe(
      error.message,
    );
  });

  it('turns down more than 1 GB at once', () => {
    expect(saveOutcome({ state: 'too-large', bytes: 1.5 * 1024 ** 3 })).toBe(
      'That’s 1,536 MB. Save up to 1 GB at a time: pick fewer photos.',
    );
  });

  it('has nothing to say while saving', () => {
    const progress = { done: 0, total: 2, bytesDone: 0, bytesTotal: 0 };
    expect(saveOutcome({ state: 'saving', progress })).toBeNull();
  });
});
