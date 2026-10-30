import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { loadAutoLock, saveAutoLock } from '../lib/auto-lock';
import type { AutoLockMinutes } from '../lib/auto-lock';
import { IdleTimer } from '../lib/idle-timer';
import { useAccount } from './account';
import { useDownloads } from './downloads';
import { useImports } from './imports';
import { useUploads } from './uploads';

interface AutoLockValue {
  minutes: AutoLockMinutes;
  setMinutes: (minutes: AutoLockMinutes) => void;
}

const AutoLockContext = createContext<AutoLockValue | null>(null);

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Holds the auto-lock choice for this browser, so it outlives locking and reloads. */
export function AutoLockProvider({ children }: { children: ReactNode }) {
  const [minutes, setState] = useState<AutoLockMinutes>(() => loadAutoLock(browserStorage()));
  const value = useMemo<AutoLockValue>(
    () => ({
      minutes,
      setMinutes: (next) => {
        saveAutoLock(browserStorage(), next);
        setState(next);
      },
    }),
    [minutes],
  );
  return <AutoLockContext value={value}>{children}</AutoLockContext>;
}

export function useAutoLock(): AutoLockValue {
  const autoLock = useContext(AutoLockContext);
  if (!autoLock) throw new Error('useAutoLock must be used inside AutoLockProvider');
  return autoLock;
}

/** What counts as using Twofold. A hidden tab sees none of these, so its time counts as idle. */
const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];

/**
 * Locks the unlocked vault after the chosen minutes without use. Uploads, imports and
 * downloads in progress count as use, so a long one isn't dropped halfway; the countdown starts again
 * when they finish.
 */
export function IdleLock() {
  const { state, lock } = useAccount();
  const { minutes } = useAutoLock();
  const uploads = useUploads();
  const downloads = useDownloads();
  const imports = useImports();
  const running = uploads.running || downloads.running || imports.running;
  const unlocked = state.status === 'unlocked';
  // The latest lock, without restarting the countdown each time the account value changes.
  const lockRef = useRef(lock);
  useEffect(() => {
    lockRef.current = lock;
  }, [lock]);

  useEffect(() => {
    if (!unlocked || minutes === 0 || running) return;
    const timer = new IdleTimer(minutes * 60_000, () => {
      lockRef.current();
    });
    const touch = () => {
      timer.touch();
    };
    const check = () => {
      if (document.visibilityState === 'visible') timer.check();
    };
    for (const type of ACTIVITY) {
      window.addEventListener(type, touch, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', check);
    return () => {
      timer.stop();
      for (const type of ACTIVITY) window.removeEventListener(type, touch, { capture: true });
      document.removeEventListener('visibilitychange', check);
    };
  }, [unlocked, minutes, running]);

  return null;
}
