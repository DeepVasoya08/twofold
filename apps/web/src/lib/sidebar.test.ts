import { describe, expect, it } from 'vitest';

import { SIDEBAR_STORAGE_KEY, loadSidebarCollapsed, saveSidebarCollapsed } from './sidebar';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

describe('sidebar preference', () => {
  it('is open until it is folded, and remembers either choice', () => {
    const storage = memoryStorage();
    expect(loadSidebarCollapsed(storage)).toBe(false);
    saveSidebarCollapsed(storage, true);
    expect(storage.getItem(SIDEBAR_STORAGE_KEY)).toBe('1');
    expect(loadSidebarCollapsed(storage)).toBe(true);
    saveSidebarCollapsed(storage, false);
    expect(loadSidebarCollapsed(storage)).toBe(false);
  });

  it('falls back to open when storage is missing or blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSidebarCollapsed(undefined)).toBe(false);
    expect(loadSidebarCollapsed(blocked)).toBe(false);
    expect(() => {
      saveSidebarCollapsed(blocked, true);
    }).not.toThrow();
  });
});
