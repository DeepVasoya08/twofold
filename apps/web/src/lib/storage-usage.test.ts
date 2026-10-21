import { describe, expect, it } from 'vitest';

import { STORAGE_SIZES } from '@twofold/types';

import type { Photo } from '../mock/data';
import { formatBytes, shownUsage, spaceBytes, usageLabel, usedFraction } from './storage-usage';

const photo = (id: string, size?: number, library?: string): Photo => ({
  id,
  src: '',
  width: 1,
  height: 1,
  takenAt: '2026-10-19T00:00:00.000Z',
  addedBy: 'me',
  favorite: false,
  albumIds: [],
  ...(size === undefined ? {} : { size }),
  ...(library === undefined ? {} : { library }),
});

describe('spaceBytes', () => {
  it('adds up the open space’s photos, leaving out shared libraries', () => {
    expect(spaceBytes([])).toBe(0);
    expect(spaceBytes([photo('a', 1000), photo('b', 24), photo('c', 5000, 'Kim')])).toBe(1024);
  });

  it('counts a photo without a known size as nothing', () => {
    expect(spaceBytes([photo('a'), photo('b', 10)])).toBe(10);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [740 * 1024, '740 KB'],
    [12.44 * 1024 * 1024, '12.4 MB'],
    [STORAGE_SIZES.accountQuota, '1 GB'],
    [-5, '0 B'],
  ])('%i bytes is %s', (bytes, label) => {
    expect(formatBytes(bytes)).toBe(label);
  });
});

describe('shownUsage', () => {
  it('shows the main library only its own photos, never the account total', () => {
    expect(shownUsage('main', 100, null)).toEqual({ bytes: 100, scope: 'here' });
    expect(shownUsage('main', 100, 5000)).toEqual({ bytes: 100, scope: 'here' });
  });

  it('shows the private space the account total, once known', () => {
    expect(shownUsage('private', 100, null)).toEqual({ bytes: 100, scope: 'total' });
    expect(shownUsage('private', 100, 5000)).toEqual({ bytes: 5000, scope: 'total' });
    // A total from before this space's latest upload is never shown as less than the space.
    expect(shownUsage('private', 6000, 5000)).toEqual({ bytes: 6000, scope: 'total' });
  });
});

describe('usedFraction and usageLabel', () => {
  it('measures against the 1 GB account limit, within 0 and 1', () => {
    expect(usedFraction(STORAGE_SIZES.accountQuota / 4)).toBe(0.25);
    expect(usedFraction(STORAGE_SIZES.accountQuota * 2)).toBe(1);
    expect(usedFraction(-1)).toBe(0);
    expect(usageLabel(3 * 1024 * 1024, 'here')).toBe('3 MB of 1 GB used here');
    expect(usageLabel(3 * 1024 * 1024, 'total')).toBe('3 MB of 1 GB used in total');
  });
});
