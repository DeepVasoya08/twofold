import { describe, expect, it } from 'vitest';

import { storageShown } from './storage-text';

const GB = 1024 * 1024 * 1024;

describe('storageShown', () => {
  it('says how much of the limit is used, and how full the bar is', () => {
    expect(storageShown(GB / 4, GB)).toEqual({ label: '256 MB of 1 GB', fraction: 0.25 });
  });

  it('keeps the bar between empty and full', () => {
    expect(storageShown(2 * GB, GB).fraction).toBe(1);
    expect(storageShown(10, 0).fraction).toBe(0);
  });
});
