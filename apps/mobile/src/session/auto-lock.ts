import { File, Paths } from 'expo-file-system';

import { AUTO_LOCK_MINUTES } from './state';

/** The auto-lock choices, in minutes, as on the web. */
export const AUTO_LOCK_CHOICES = [1, 5, 15, 30] as const;

/** A saved choice as it can be used: one of the choices, or the default. */
export function cleanAutoLock(text: string | null): number {
  const minutes = Number(text?.trim());
  return (AUTO_LOCK_CHOICES as readonly number[]).includes(minutes) ? minutes : AUTO_LOCK_MINUTES;
}

/** "1 minute", "15 minutes". */
export function autoLockLabel(minutes: number): string {
  return minutes === 1 ? '1 minute' : `${String(minutes)} minutes`;
}

/**
 * How long this phone waits before locking, kept in the app's private storage. It's a setting
 * of the phone, the same whichever space is open.
 */
const file = () => new File(Paths.document, 'auto-lock-minutes.txt');

export async function savedAutoLock(): Promise<number> {
  try {
    const saved = file();
    return saved.exists ? cleanAutoLock(await saved.text()) : AUTO_LOCK_MINUTES;
  } catch {
    return AUTO_LOCK_MINUTES;
  }
}

export async function saveAutoLock(minutes: number): Promise<void> {
  try {
    await file().write(String(cleanAutoLock(String(minutes))));
  } catch {
    // Only a convenience: the default applies next time.
  }
}
