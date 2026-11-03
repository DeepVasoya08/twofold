import { describe, expect, it } from 'vitest';

import { aspectOf, loadView, parseView, saveView } from './views';

describe('views', () => {
  it('falls back to the first view for anything unknown', () => {
    expect(parseView('photos', null)).toBe('grid');
    expect(parseView('photos', 'compact')).toBe('compact');
    expect(parseView('photos', 'list')).toBe('grid');
    expect(parseView('files', 'grid')).toBe('grid');
    expect(parseView('files', 'uncropped')).toBe('list');
  });

  it('keeps the choice per device, and copes with storage that throws', () => {
    const stored = new Map<string, string>();
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        stored.set(key, value);
      },
    };
    saveView('photos', 'uncropped', storage);
    saveView('files', 'grid', storage);
    expect(loadView('photos', storage)).toBe('uncropped');
    expect(loadView('files', storage)).toBe('grid');
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadView('photos', broken)).toBe('grid');
    expect(() => {
      saveView('photos', 'compact', broken);
    }).not.toThrow();
    expect(loadView('files', undefined)).toBe('list');
  });

  it('gives each photo its shape, within 1:3 and 3:1', () => {
    expect(aspectOf(4000, 3000)).toBeCloseTo(4 / 3);
    expect(aspectOf(3000, 4000)).toBeCloseTo(0.75);
    expect(aspectOf(10_000, 1000)).toBe(3);
    expect(aspectOf(500, 5000)).toBeCloseTo(1 / 3);
    expect(aspectOf(0, 0)).toBe(1);
    expect(aspectOf(Number.NaN, 10)).toBe(1);
  });
});
