/**
 * Whether the wide-screen sidebar is folded down to icons. A plain layout preference for
 * this browser, kept in localStorage; nothing secret is stored with it.
 */

export const SIDEBAR_STORAGE_KEY = 'arcafold.sidebarCollapsed';

/** Storage can be missing or blocked (private windows, strict settings); open is the default. */
export function loadSidebarCollapsed(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return storage?.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(
  storage: Pick<Storage, 'setItem'> | undefined,
  collapsed: boolean,
): void {
  try {
    storage?.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // Not saved, so the next visit opens it again; this visit still keeps the choice.
  }
}
