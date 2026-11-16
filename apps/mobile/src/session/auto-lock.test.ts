import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-file-system', () => ({ File: vi.fn(), Paths: {} }));

const { autoLockLabel, cleanAutoLock } = await import('./auto-lock');

describe('auto-lock choice', () => {
  it('keeps one of the choices and falls back to a minute otherwise', () => {
    expect(cleanAutoLock('15')).toBe(15);
    expect(cleanAutoLock(' 5\n')).toBe(5);
    expect(cleanAutoLock('7')).toBe(1);
    expect(cleanAutoLock('soon')).toBe(1);
    expect(cleanAutoLock(null)).toBe(1);
  });

  it('reads as words', () => {
    expect(autoLockLabel(1)).toBe('1 minute');
    expect(autoLockLabel(30)).toBe('30 minutes');
  });
});
