import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-file-system', () => ({ File: vi.fn(), Paths: {} }));

const { DEFAULT_SMART_SETTINGS, cleanSmartSettings, facesOn } = await import('./smart-settings');

describe('cleanSmartSettings', () => {
  it('reads what was saved', () => {
    expect(cleanSmartSettings('{"search":"off","faces":"on"}')).toEqual({
      search: false,
      faces: 'on',
    });
  });

  it('falls back to the defaults for anything missing or unreadable', () => {
    expect(cleanSmartSettings(null)).toEqual(DEFAULT_SMART_SETTINGS);
    expect(cleanSmartSettings('not json')).toEqual(DEFAULT_SMART_SETTINGS);
    expect(cleanSmartSettings('{"faces":"maybe"}')).toEqual({ search: true, faces: null });
  });
});

describe('facesOn', () => {
  it('follows this phone’s choice, then the account’s answer, and is off without either', () => {
    const yes = { choice: 'on' as const, version: 1 };
    const no = { choice: 'off' as const, version: 1 };
    expect(facesOn({ search: true, faces: 'off' }, yes)).toBe(false);
    expect(facesOn({ search: true, faces: 'on' }, no)).toBe(true);
    expect(facesOn({ search: true, faces: null }, yes)).toBe(true);
    expect(facesOn({ search: true, faces: null }, null)).toBe(false);
  });
});
