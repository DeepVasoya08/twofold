import { describe, expect, it } from 'vitest';

import { settleEach } from './settle-each';

describe('settleEach', () => {
  it('runs every item, no more than the limit at once', async () => {
    let running = 0;
    let most = 0;
    const result = await settleEach([1, 2, 3, 4, 5], 2, async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
    });
    expect(result).toEqual({ done: [1, 2, 3, 4, 5], failed: [] });
    expect(most).toBe(2);
  });

  it('keeps going past failures and reports the first error', async () => {
    const result = await settleEach(['a', 'b', 'c'], 3, async (item) => {
      await Promise.resolve();
      if (item !== 'b') throw new Error(`no ${item}`);
    });
    expect(result.done).toEqual(['b']);
    expect(result.failed).toEqual(['a', 'c']);
    expect(result.error).toEqual(new Error('no a'));
  });

  it('handles nothing to do', async () => {
    expect(await settleEach([], 4, () => Promise.resolve())).toEqual({ done: [], failed: [] });
  });
});
