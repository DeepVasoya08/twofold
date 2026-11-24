import { describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE, cleanAppearance, schemeFor } from './appearance-settings';

describe('cleanAppearance', () => {
  it('reads saved choices', () => {
    expect(
      cleanAppearance(
        '{"theme":"dark","photoView":"uncropped","albumView":"small","fileView":"grid","peopleView":"small"}',
      ),
    ).toEqual({
      theme: 'dark',
      photoView: 'uncropped',
      albumView: 'small',
      fileView: 'grid',
      peopleView: 'small',
    });
  });

  it('falls back to the defaults for anything unknown or unreadable', () => {
    expect(cleanAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(cleanAppearance('not json')).toEqual(DEFAULT_APPEARANCE);
    expect(cleanAppearance('"dark"')).toEqual(DEFAULT_APPEARANCE);
    expect(cleanAppearance('{"theme":"neon","photoView":"compact","fileView":"table"}')).toEqual({
      ...DEFAULT_APPEARANCE,
      photoView: 'compact',
    });
  });
});

describe('schemeFor', () => {
  it('follows the phone only when set to system', () => {
    expect(schemeFor('system', 'light')).toBe('light');
    expect(schemeFor('system', 'dark')).toBe('dark');
    expect(schemeFor('system', null)).toBe('dark');
    expect(schemeFor('light', 'dark')).toBe('light');
    expect(schemeFor('dark', 'light')).toBe('dark');
  });
});
