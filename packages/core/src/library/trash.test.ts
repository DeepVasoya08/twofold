import { describe, expect, it } from 'vitest';

import { GONE, daysLeftLabel, moveAll, removeAll } from './trash';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-30T12:00:00.000Z');

describe('daysLeftLabel', () => {
  it('counts down, then says it’s the last day', () => {
    expect(daysLeftLabel({ deletedAt: new Date(NOW - 2 * DAY).toISOString() }, NOW)).toBe(
      '28 days left',
    );
    expect(daysLeftLabel({ deletedAt: new Date(NOW - 29.5 * DAY).toISOString() }, NOW)).toBe(
      'Last day',
    );
    expect(daysLeftLabel({}, NOW)).toBe('');
  });
});

describe('moveAll', () => {
  it('moves what the check lets through, in one call, and fails the rest', async () => {
    const calls: string[][] = [];
    const result = await moveAll(
      ['a', 'b', 'c'],
      (ids) => {
        calls.push(ids);
        return Promise.resolve(ids.filter((id) => id !== 'c'));
      },
      (id) => {
        if (id === 'b') throw new Error('view only');
      },
    );
    expect(calls).toEqual([['a', 'c']]);
    expect(result.done).toEqual(['a']);
    expect(result.failed).toEqual(['b', 'c']);
    expect((result.error as Error).message).toBe('view only');
  });

  it('says a photo is gone when the server didn’t move it', async () => {
    const result = await moveAll(['a'], () => Promise.resolve([]));
    expect((result.error as Error).message).toBe(GONE);
  });
});

describe('removeAll', () => {
  it('deletes each, and says which failed', async () => {
    const result = await removeAll(['a', 'b'], (id) =>
      id === 'b' ? Promise.reject(new Error('offline')) : Promise.resolve(),
    );
    expect(result.done).toEqual(['a']);
    expect(result.failed).toEqual(['b']);
  });
});
