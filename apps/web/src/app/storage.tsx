import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { api } from '../lib/api';
import { shownUsage, spaceBytes } from '../lib/storage-usage';
import type { UsageScope } from '../lib/storage-usage';
import { useVault } from './vault';

/**
 * The storage figure for the open space. The 1 GB limit is shared by both spaces. The main
 * library shows only its own photos, worked out here from its list, and never asks the
 * server for the account's total: that would include the private space and hint that one
 * exists. The private space shows the account's total, which it asks for once it has
 * loaded and again (once, a moment later) whenever its own photos change size.
 */

export interface StorageUsage {
  bytes: number;
  scope: UsageScope;
}

const StorageContext = createContext<StorageUsage | null>(null);

/** How long the private space waits after a change before asking for the total again. */
const REFRESH_DELAY_MS = 800;

const fetchAccountTotal = () => api.storage().then((storage) => storage.used);

export function StorageProvider({
  children,
  remote,
  fetchTotal = fetchAccountTotal,
}: {
  children: ReactNode;
  /** Whether a server is behind the vault (not in previews and tests). */
  remote: boolean;
  fetchTotal?: () => Promise<number>;
}) {
  const { state, space, status } = useVault();
  const own = useMemo(() => spaceBytes(state.photos), [state.photos]);
  const wantsTotal = remote && space === 'private' && status === 'ready';
  const [total, setTotal] = useState<number | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (!wantsTotal) return;
    let cancelled = false;
    // The first time straight away, and after that only once changes have settled. `own`
    // is a dependency so a change to this space's photos asks again.
    const delay = asked.current ? REFRESH_DELAY_MS : 0;
    const timer = setTimeout(() => {
      asked.current = true;
      fetchTotal().then(
        (used) => {
          if (!cancelled) setTotal(used);
        },
        () => undefined,
      );
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [wantsTotal, own, fetchTotal]);

  const value = useMemo<StorageUsage>(() => shownUsage(space, own, total), [space, own, total]);
  return <StorageContext value={value}>{children}</StorageContext>;
}

export function useStorageUsage(): StorageUsage {
  const usage = useContext(StorageContext);
  if (!usage) throw new Error('useStorageUsage must be used inside StorageProvider');
  return usage;
}
