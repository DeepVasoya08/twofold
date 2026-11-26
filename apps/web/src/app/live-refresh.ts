import { useEffect } from 'react';

import type { SpaceStore } from '@arcafold/core/library/space-store';

/** How often an open, visible app asks the server whether anything it shows changed. */
export const CHECK_EVERY_MS = 15_000;

/** Coming back to the tab checks straight away, unless the last check was this recent. */
export const RECHECK_AFTER_MS = 5_000;

/** Store calls that only read, which never hold back a refresh. */
const READS = new Set<string>([
  'list',
  'image',
  'viewImage',
  'thumbs',
  'previews',
  'listTrash',
  'read',
  'original',
  'fingerprint',
  'fingerprints',
  'stamp',
  'dispose',
]);

/**
 * `store`, counting the changes it has under way (uploads among them), so a refresh never
 * lands on top of a change this device is still making: `busy` says whether there are any.
 */
export function countingWrites(store: SpaceStore): { store: SpaceStore; busy: () => boolean } {
  const writes = { current: 0 };
  const counted: Record<string, unknown> = { ...store };
  for (const [name, call] of Object.entries(store)) {
    if (READS.has(name) || typeof call !== 'function') continue;
    const method = call as (...args: unknown[]) => unknown;
    counted[name] = (...args: unknown[]) => {
      writes.current += 1;
      let result: unknown;
      try {
        result = method(...args);
      } catch (error) {
        writes.current -= 1;
        throw error;
      }
      if (result instanceof Promise) {
        return result.finally(() => {
          writes.current -= 1;
        });
      }
      writes.current -= 1;
      return result;
    };
  }
  return { store: counted as unknown as SpaceStore, busy: () => writes.current > 0 };
}

/**
 * Keeps an open vault current with changes made elsewhere: another device, or someone it's
 * shared with. While the page is visible it asks for the store's stamp every CHECK_EVERY_MS,
 * and straight away when the page comes back into view (unless it just asked, so flicking
 * between tabs sends nothing), and lists again only when the stamp moved. `refresh` says whether it took the new listing; if not, the next check tries again.
 */
export function useLiveRefresh({
  store,
  enabled,
  refresh,
}: {
  store: SpaceStore;
  enabled: boolean;
  refresh: () => Promise<boolean>;
}): void {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    // A function, so checks after an await see the cleanup's change.
    const isStopped = () => stopped;
    let checking = false;
    let seen: string | null = null;
    let lastCheck = 0;
    const check = async () => {
      if (isStopped() || checking || document.visibilityState !== 'visible') return;
      checking = true;
      lastCheck = Date.now();
      try {
        const stamp = await store.stamp();
        if (seen === null) seen = stamp;
        else if (stamp !== seen && !isStopped() && (await refresh())) seen = stamp;
      } catch {
        // Offline or signed out: the next check tries again, and a sign-out is handled elsewhere.
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    const onVisible = () => {
      if (Date.now() - lastCheck >= RECHECK_AFTER_MS) void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [store, enabled, refresh]);
}
