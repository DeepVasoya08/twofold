import { describe, expect, it } from 'vitest';

import { photosToIndex, waitForWifi, wipeResults } from './index-plan';
import type { SearchResults } from '@arcafold/core/search/segment';

describe('photosToIndex', () => {
  const order = ['a', 'b', 'c', 'd'];
  const done: SearchResults = new Map([['b', null]]);

  it('is every photo without a vector yet, on a computer', () => {
    expect(photosToIndex({ order, done, phone: false, uploadedHere: new Set() })).toEqual([
      'a',
      'c',
      'd',
    ]);
  });

  it('is only the photos this phone uploaded, on a phone', () => {
    const uploadedHere = new Set(['b', 'd', 'gone']);
    expect(photosToIndex({ order, done, phone: true, uploadedHere })).toEqual(['d']);
    expect(photosToIndex({ order, done, phone: true, uploadedHere: new Set() })).toEqual([]);
  });
});

describe('waitForWifi', () => {
  const phone = { phone: true, connection: 'unknown', cached: false, allowed: false } as const;

  it('waits on a phone that is not known to be on Wi-Fi', () => {
    expect(waitForWifi(phone)).toBe(true);
    expect(waitForWifi({ ...phone, connection: 'metered' })).toBe(true);
  });

  it('goes ahead on Wi-Fi, from the cache, when allowed, and on a computer', () => {
    expect(waitForWifi({ ...phone, connection: 'wifi' })).toBe(false);
    expect(waitForWifi({ ...phone, cached: true })).toBe(false);
    expect(waitForWifi({ ...phone, allowed: true })).toBe(false);
    expect(waitForWifi({ ...phone, phone: false, connection: 'metered' })).toBe(false);
  });
});

describe('wipeResults', () => {
  it('zeroes every vector and empties the map', () => {
    const vector = new Float32Array([0.6, 0.8]);
    const results: SearchResults = new Map([
      ['a', vector],
      ['b', null],
    ]);
    wipeResults(results);
    expect(results.size).toBe(0);
    expect([...vector]).toEqual([0, 0]);
  });
});
