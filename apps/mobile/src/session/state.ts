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

/** Minutes without a touch, with the app on screen, before it locks (as on the web). */
export const AUTO_LOCK_MINUTES = 1;

/** The same account, locked: its keys are dropped, the server session stays. */
export function locked(state: AccountState): AccountState {
  return state.status === 'unlocked' ? { status: 'locked', account: state.session.account } : state;
}

/** Whether the app has sat untouched on screen long enough to lock. */
export function idleTooLong(
  lastTouch: number,
  now: number,
  minutes: number = AUTO_LOCK_MINUTES,
): boolean {
  return now - lastTouch >= minutes * 60_000;
}

/**
 * Whether an app state change means the app left the screen. 'inactive' (a system dialog,
 * or the app switcher on iPhone) doesn't lock, so a permission prompt can't lock mid-task;
 * the screen is blanked in the app switcher anyway.
 */
export function leftScreen(next: string): boolean {
  return next === 'background';
}

/** A remembered email as it can be used, or null if it isn't one. */
export function cleanEmail(text: string): string | null {
  const email = text.trim();
  return isValidEmail(email) ? email : null;
}
