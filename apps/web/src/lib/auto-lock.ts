/**
 * The auto-lock choice in Settings. It is a plain preference for this browser, kept in
 * localStorage; nothing secret or decrypted is stored with it.
 */

/** Minutes without use before Arcafold locks; 0 means only when the tab closes. */
export type AutoLockMinutes = 0 | 1 | 5 | 15;

export const AUTO_LOCK_CHOICES: readonly { minutes: AutoLockMinutes; label: string }[] = [
  { minutes: 1, label: '1 minute' },
  { minutes: 5, label: '5 minutes' },
  { minutes: 15, label: '15 minutes' },
  { minutes: 0, label: 'When I close the tab' },
];

export const DEFAULT_AUTO_LOCK: AutoLockMinutes = 1;

export const AUTO_LOCK_STORAGE_KEY = 'arcafold.autoLockMinutes';

/** Reads a stored or chosen value, falling back to the default for anything unknown. */
export function parseAutoLock(value: string | null): AutoLockMinutes {
  const choice = AUTO_LOCK_CHOICES.find((option) => String(option.minutes) === value);
  return choice ? choice.minutes : DEFAULT_AUTO_LOCK;
}

/** Storage can be missing or blocked (private windows, strict settings); the default applies. */
export function loadAutoLock(storage: Pick<Storage, 'getItem'> | undefined): AutoLockMinutes {
  try {
    return parseAutoLock(storage?.getItem(AUTO_LOCK_STORAGE_KEY) ?? null);
  } catch {
    return DEFAULT_AUTO_LOCK;
  }
}

export function saveAutoLock(
  storage: Pick<Storage, 'setItem'> | undefined,
  minutes: AutoLockMinutes,
): void {
  try {
    storage?.setItem(AUTO_LOCK_STORAGE_KEY, String(minutes));
  } catch {
    // Not saved, so the next visit uses the default; this visit still uses the choice.
  }
}
