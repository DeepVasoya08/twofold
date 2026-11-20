import { useCallback, useState } from 'react';

/** The set with `id` added, or taken out if it was there. */
export function toggled(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

export interface Selection {
  /** The photos picked, or null when not selecting. */
  selected: ReadonlySet<string> | null;
  /** Starts selecting with this photo (a long press). */
  start: (photoId: string) => void;
  /** Picks or unpicks a photo. */
  toggle: (photoId: string) => void;
  /** Picks exactly these (keeping selecting on). */
  replace: (photoIds: readonly string[]) => void;
  /** Stops selecting. */
  clear: () => void;
}

/** Picking photos to act on together: started by a long press, ended by ✕ or back. */
export function useSelection(): Selection {
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const start = useCallback((photoId: string) => {
    setSelected((current) => (current ? toggled(current, photoId) : new Set([photoId])));
  }, []);
  const toggle = useCallback((photoId: string) => {
    setSelected((current) => toggled(current ?? new Set(), photoId));
  }, []);
  const replace = useCallback((photoIds: readonly string[]) => {
    setSelected(new Set(photoIds));
  }, []);
  const clear = useCallback(() => {
    setSelected(null);
  }, []);
  return { selected, start, toggle, replace, clear };
}
