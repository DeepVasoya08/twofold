import { describe, expect, it } from 'vitest';

import { SMART_FEATURES_VERSION } from '@arcafold/types';

import { FACE_SETTING_KEY, faceGroupingOn, loadFaceSetting, saveFaceSetting } from './face-setting';

function memory(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  } as unknown as Storage;
}

const said = (choice: 'on' | 'off') => ({ choice, version: SMART_FEATURES_VERSION });

describe('face setting', () => {
  it('has no choice until one is made here, and remembers it', () => {
    const storage = memory();
    expect(loadFaceSetting(storage)).toBeNull();
    saveFaceSetting(storage, true);
    expect(storage.getItem(FACE_SETTING_KEY)).toBe('on');
    expect(loadFaceSetting(storage)).toBe('on');
    saveFaceSetting(storage, false);
    expect(loadFaceSetting(storage)).toBe('off');
  });

  it('counts blocked, missing or unknown storage as no choice', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadFaceSetting(blocked)).toBeNull();
    expect(() => {
      saveFaceSetting(blocked, true);
    }).not.toThrow();
    expect(loadFaceSetting(undefined)).toBeNull();
    const odd = memory();
    odd.setItem(FACE_SETTING_KEY, 'yes');
    expect(loadFaceSetting(odd)).toBeNull();
  });
});

describe('faceGroupingOn', () => {
  it('follows the account when this device never chose', () => {
    expect(faceGroupingOn(null, said('on'))).toBe(true);
    expect(faceGroupingOn(null, said('off'))).toBe(false);
  });

  it('is off while the question is unanswered', () => {
    expect(faceGroupingOn(null, null)).toBe(false);
  });

  it('lets this device’s choice win over the account', () => {
    expect(faceGroupingOn('off', said('on'))).toBe(false);
    expect(faceGroupingOn('on', said('off'))).toBe(true);
    expect(faceGroupingOn('on', null)).toBe(true);
  });
});
