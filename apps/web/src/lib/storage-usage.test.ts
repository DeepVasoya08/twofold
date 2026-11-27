import { describe, expect, it } from 'vitest';

import { PLAN_STORAGE, STORAGE_SIZES } from '@arcafold/types';

import {
  DEFAULT_LIMIT,
  formatBytes,
  shownUsage,
  spaceBytes,
  usageLabel,
  usedFraction,
} from './storage-usage';
import type { Photo } from '@arcafold/core/library/model';

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
  it('shows the account total once known, and never less than the open space', () => {
    expect(shownUsage(100, null)).toBe(100);
    expect(shownUsage(100, 5000)).toBe(5000);
    // A total from before this space's latest upload is never shown as less than the space.
    expect(shownUsage(6000, 5000)).toBe(6000);
  });
});

describe('usedFraction and usageLabel', () => {
  it('measures against the account’s limit, within 0 and 1', () => {
    expect(usedFraction(DEFAULT_LIMIT / 4, DEFAULT_LIMIT)).toBe(0.25);
    expect(usedFraction(DEFAULT_LIMIT * 2, DEFAULT_LIMIT)).toBe(1);
    expect(usedFraction(-1, DEFAULT_LIMIT)).toBe(0);
    expect(usedFraction(1, 0)).toBe(1);
    expect(usageLabel(3 * 1024 * 1024, DEFAULT_LIMIT)).toBe('3 MB of 1 GB used');
  });

  it('shows a paid plan’s limit', () => {
    expect(usedFraction(PLAN_STORAGE.plus / 2, PLAN_STORAGE.plus)).toBe(0.5);
    expect(usageLabel(2 * 1024 * 1024 * 1024, PLAN_STORAGE.plus)).toBe('2 GB of 50 GB used');
    expect(usageLabel(0, PLAN_STORAGE.max)).toBe('0 B of 1 TB used');
  });
});
