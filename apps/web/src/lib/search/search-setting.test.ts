import { describe, expect, it } from 'vitest';

import { SEARCH_SETTING_KEY, loadSearchSetting, saveSearchSetting } from './search-setting';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

describe('search setting', () => {
  it('is on until this device turns it off', () => {
    const storage = memoryStorage();
    expect(loadSearchSetting(storage)).toBe(true);
    saveSearchSetting(storage, false);
    expect(storage.getItem(SEARCH_SETTING_KEY)).toBe('off');
    expect(loadSearchSetting(storage)).toBe(false);
    saveSearchSetting(storage, true);
    expect(loadSearchSetting(storage)).toBe(true);
  });

  it('stays on when storage is missing or blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSearchSetting(undefined)).toBe(true);
    expect(loadSearchSetting(blocked)).toBe(true);
    expect(() => {
      saveSearchSetting(blocked, false);
    }).not.toThrow();
  });
});
