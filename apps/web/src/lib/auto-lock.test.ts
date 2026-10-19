import { describe, expect, it } from 'vitest';

import {
  AUTO_LOCK_STORAGE_KEY,
  DEFAULT_AUTO_LOCK,
  loadAutoLock,
  parseAutoLock,
  saveAutoLock,
} from './auto-lock';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const blocked: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('auto-lock preference', () => {
  it('defaults to 15 minutes', () => {
    expect(DEFAULT_AUTO_LOCK).toBe(15);
    expect(loadAutoLock(memoryStorage())).toBe(15);
    expect(loadAutoLock(undefined)).toBe(15);
  });

  it('keeps the choice between visits', () => {
    const storage = memoryStorage();
    saveAutoLock(storage, 1);
    expect(loadAutoLock(storage)).toBe(1);
    saveAutoLock(storage, 0);
    expect(loadAutoLock(storage)).toBe(0);
  });

  it('ignores values that are not a choice', () => {
    expect(parseAutoLock('2')).toBe(15);
    expect(parseAutoLock('')).toBe(15);
    expect(parseAutoLock(null)).toBe(15);
    const storage = memoryStorage();
    storage.setItem(AUTO_LOCK_STORAGE_KEY, 'forever');
    expect(loadAutoLock(storage)).toBe(15);
  });

  it('falls back to the default when storage is blocked', () => {
    expect(() => {
      saveAutoLock(blocked, 1);
    }).not.toThrow();
    expect(loadAutoLock(blocked)).toBe(15);
  });
});
