import { describe, expect, it } from 'vitest';

import { FACE_SETTING_KEY, loadFaceSetting, saveFaceSetting } from './face-setting';

function memory(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  } as unknown as Storage;
}

describe('face setting', () => {
  it('is off until turned on, and remembers the choice', () => {
    const storage = memory();
    expect(loadFaceSetting(storage)).toBe(false);
    saveFaceSetting(storage, true);
    expect(storage.getItem(FACE_SETTING_KEY)).toBe('on');
    expect(loadFaceSetting(storage)).toBe(true);
    saveFaceSetting(storage, false);
    expect(loadFaceSetting(storage)).toBe(false);
  });

  it('counts blocked or missing storage as off', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadFaceSetting(blocked)).toBe(false);
    expect(() => {
      saveFaceSetting(blocked, true);
    }).not.toThrow();
    expect(loadFaceSetting(undefined)).toBe(false);
  });
});
