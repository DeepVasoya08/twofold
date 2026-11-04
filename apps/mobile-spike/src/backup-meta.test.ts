import { describe, expect, it } from 'vitest';

import { eachLimited, finishedInBackground, longestGap } from './backup-meta';

describe('eachLimited', () => {
  it('runs every item, never more than the limit at once', async () => {
    let running = 0;
    let most = 0;
    const seen: number[] = [];
    await eachLimited([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      running++;
      most = Math.max(most, running);
      await Promise.resolve();
      seen.push(item);
      running--;
    });
    expect(most).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('handles an empty list', async () => {
    await expect(eachLimited([], 3, () => Promise.resolve())).resolves.toBeUndefined();
  });
});

describe('timing summaries', () => {
  const spans = [
    { state: 'active', from: 0, to: 100 },
    { state: 'background', from: 100, to: 500 },
    { state: 'active', from: 500, to: 900 },
  ];

  it('counts photos finished while the app was off screen', () => {
    expect(finishedInBackground([50, 150, 450, 600], spans)).toBe(2);
  });

  it('finds the longest pause between photos', () => {
    expect(longestGap(0, [450, 50, 150])).toBe(300);
    expect(longestGap(10, [])).toBe(0);
  });
});
