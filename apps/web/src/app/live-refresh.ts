import { useEffect } from 'react';

import { CHECK_EVERY_MS, RECHECK_AFTER_MS } from '@arcafold/core/library/counting-writes';
import type { SpaceStore } from '@arcafold/core/library/space-store';

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
