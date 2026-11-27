import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { api } from '@arcafold/core/api';
import type { AccountStorage } from '@arcafold/types';
import { DEFAULT_LIMIT, shownUsage, spaceBytes } from '../lib/storage-usage';
import { useVault } from './vault';

/**
 * The storage figure: the account's total across both spaces and its limit (its plan's), the
 * same in either one, since the limit is shared. It's asked for once the open space has
 * loaded and again (once, a moment later) whenever that space's photos change size.
 */

interface Shown {
  used: number;
  limit: number;
}

const StorageContext = createContext<Shown | null>(null);

/** How long to wait after a change before asking for the total again. */
const REFRESH_DELAY_MS = 800;

const fetchAccountTotal = (): Promise<AccountStorage> => api.storage();

export function StorageProvider({
  children,
  remote,
  fetchTotal = fetchAccountTotal,
}: {
  children: ReactNode;
  /** Whether a server is behind the vault (not in previews and tests). */
  remote: boolean;
  fetchTotal?: () => Promise<AccountStorage>;
}) {
  const { state, status } = useVault();
  // Files count like photos. Photos in Recently deleted still take up storage until they're deleted for good.
  const own = useMemo(
    () => spaceBytes([...state.photos, ...(state.files ?? []), ...(state.trash ?? [])]),
    [state.photos, state.files, state.trash],
  );
  const wantsTotal = remote && status === 'ready';
  const [total, setTotal] = useState<AccountStorage | null>(null);
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
        (storage) => {
          if (!cancelled) setTotal(storage);
        },
        () => undefined,
      );
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [wantsTotal, own, fetchTotal]);

  const shown = useMemo(
    () => ({ used: shownUsage(own, total?.used ?? null), limit: total?.limit ?? DEFAULT_LIMIT }),
    [own, total],
  );
  return <StorageContext value={shown}>{children}</StorageContext>;
}

function useShown(): Shown {
  const shown = useContext(StorageContext);
  if (shown === null) throw new Error('useStorageUsage must be used inside StorageProvider');
  return shown;
}

/** Bytes used by the whole account. */
export function useStorageUsage(): number {
  return useShown().used;
}

/** The account's limit, from its plan: the Free plan's until the server has said. */
export function useStorageLimit(): number {
  return useShown().limit;
}
