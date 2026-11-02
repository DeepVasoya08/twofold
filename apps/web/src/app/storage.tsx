import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { api } from '../lib/api';
import { shownUsage, spaceBytes } from '../lib/storage-usage';
import { useVault } from './vault';

/**
 * The storage figure: the account's total across both spaces, the same in either one, since
 * the 1 GB limit is shared. It's asked for once the open space has loaded and again (once,
 * a moment later) whenever that space's photos change size.
 */

const StorageContext = createContext<number | null>(null);

/** How long to wait after a change before asking for the total again. */
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
  const { state, status } = useVault();
  // Files count like photos. Photos in Recently deleted still take up storage until they're deleted for good.
  const own = useMemo(
    () => spaceBytes([...state.photos, ...(state.files ?? []), ...(state.trash ?? [])]),
    [state.photos, state.files, state.trash],
  );
  const wantsTotal = remote && status === 'ready';
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

  return <StorageContext value={shownUsage(own, total)}>{children}</StorageContext>;
}

/** Bytes used by the whole account. */
export function useStorageUsage(): number {
  const usage = useContext(StorageContext);
  if (usage === null) throw new Error('useStorageUsage must be used inside StorageProvider');
  return usage;
}
