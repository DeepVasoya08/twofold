import { useCallback, useEffect, useMemo, useState } from 'react';

import { pluralize } from '../lib/format';
import type { Settled } from '../lib/settle-each';
import { errorMessage } from './account-ops';

/** Photos picked for a change to many at once. */
export interface Selection {
  selected: ReadonlySet<string>;
  /** Picking photos: a tap selects instead of opening. On while anything is selected. */
  selecting: boolean;
  toggle: (photoId: string) => void;
  /** Selects every one of `photoIds`, or clears them all. */
  setMany: (photoIds: readonly string[], selected: boolean) => void;
  /** Starts picking with nothing selected yet (for touch screens, which can't hover). */
  start: () => void;
  /** Selects only these, or stops picking when there are none. */
  replace: (photoIds: readonly string[]) => void;
  clear: () => void;
}

/** `selected` with `photoIds` all added or all taken out. */
export function withMany(
  selected: ReadonlySet<string>,
  photoIds: readonly string[],
  on: boolean,
): ReadonlySet<string> {
  const next = new Set(selected);
  for (const photoId of photoIds) {
    if (on) next.add(photoId);
    else next.delete(photoId);
  }
  return next;
}

/** Whether every one of `photoIds` is selected (and there is at least one). */
export function allSelected(selected: ReadonlySet<string>, photoIds: readonly string[]): boolean {
  return photoIds.length > 0 && photoIds.every((photoId) => selected.has(photoId));
}

/** Escape stops picking. */
export function useSelection(): Selection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [started, setStarted] = useState(false);
  const selecting = started || selected.size > 0;

  const clear = useCallback(() => {
    setSelected(new Set());
    setStarted(false);
  }, []);

  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => {
      // An open dialog handles its own Escape.
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !document.querySelector('dialog[open]')
      ) {
        clear();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [selecting, clear]);

  return useMemo(
    () => ({
      selected,
      selecting,
      toggle: (photoId) => {
        setSelected((current) => withMany(current, [photoId], !current.has(photoId)));
      },
      setMany: (photoIds, on) => {
        setSelected((current) => withMany(current, photoIds, on));
      },
      start: () => {
        setStarted(true);
      },
      replace: (photoIds) => {
        setSelected(new Set(photoIds));
        if (photoIds.length === 0) setStarted(false);
      },
      clear,
    }),
    [selected, selecting, clear],
  );
}

/**
 * What to tell someone after a change to many photos: how many went through, and how many
 * didn't. When none did, the reason the first one failed.
 */
export function batchMessage(result: Settled<string>, done: (photos: string) => string): string {
  if (result.done.length === 0) return errorMessage(result.error);
  const message = done(pluralize(result.done.length, 'photo'));
  if (result.failed.length === 0) return message;
  return `${message}. ${pluralize(result.failed.length, 'photo')} didn’t go through.`;
}
