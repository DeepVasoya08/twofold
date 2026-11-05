import type { Session } from '@arcafold/core/account';
import { isValidEmail } from '@arcafold/core/password';
import type { AccountResponse } from '@arcafold/types';

/**
 * Who is signed in, and whether their keys are in memory. Keys live only in this state:
 * locking, signing out or closing the app forgets them. The session cookie is in memory too,
 * so a closed app always starts signed out.
 */
export type AccountState =
  | { status: 'signed-out' }
  | { status: 'locked'; account: AccountResponse }
  | { status: 'unlocked'; session: Session };

/** Minutes without a touch, on screen or in the background, before it locks (as on the web). */
export const AUTO_LOCK_MINUTES = 1;

/** The same account, locked: its keys are dropped, the server session stays. */
export function locked(state: AccountState): AccountState {
  return state.status === 'unlocked' ? { status: 'locked', account: state.session.account } : state;
}

/** Whether the app has sat untouched (or in the background) long enough to lock. */
export function idleTooLong(
  lastTouch: number,
  now: number,
  minutes: number = AUTO_LOCK_MINUTES,
): boolean {
  return now - lastTouch >= minutes * 60_000;
}

/**
 * Whether an app state change means the app left the screen. 'inactive' (a system dialog,
 * or the app switcher on iPhone) doesn't count, so a permission prompt isn't time away;
 * the screen is blanked in the app switcher anyway.
 */
export function leftScreen(next: string): boolean {
  return next === 'background';
}

/**
 * How long the app may sit behind a screen of Android's own (the photo picker) without
 * locking. Past this it locks as soon as it comes back, as if it had been left.
 */
export const SYSTEM_SCREEN_GRACE_MS = 3 * 60_000;

/**
 * Whether the app should lock as it comes back on screen: it was left for a system screen
 * (`leftAt`, null if it wasn't) and was away longer than the grace.
 */
export function lockOnReturn(
  leftAt: number | null,
  now: number,
  grace: number = SYSTEM_SCREEN_GRACE_MS,
): boolean {
  return leftAt !== null && now - leftAt >= grace;
}

/** A remembered email as it can be used, or null if it isn't one. */
export function cleanEmail(text: string): string | null {
  const email = text.trim();
  return isValidEmail(email) ? email : null;
}
