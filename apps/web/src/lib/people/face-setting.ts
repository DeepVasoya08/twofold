/**
 * Whether this device finds faces. The account says whether face grouping starts on (the
 * smart features question after sign-up); a choice made on this device, kept in localStorage
 * like auto-lock, overrides it. Either way it applies to whichever space is open: the
 * main library can't show that face grouping was turned on in another space, because the
 * setting and the downloaded resources look the same either way.
 */
import type { SmartFeaturesChoice } from '@twofold/types';

export const FACE_SETTING_KEY = 'twofold.faceGrouping';

/** What this device chose, or null if it never chose (or storage is missing or blocked). */
export type FacePreference = 'on' | 'off' | null;

export function loadFaceSetting(storage: Pick<Storage, 'getItem'> | undefined): FacePreference {
  try {
    const stored = storage?.getItem(FACE_SETTING_KEY);
    return stored === 'on' || stored === 'off' ? stored : null;
  } catch {
    return null;
  }
}

export function saveFaceSetting(storage: Pick<Storage, 'setItem'> | undefined, on: boolean): void {
  try {
    storage?.setItem(FACE_SETTING_KEY, on ? 'on' : 'off');
  } catch {
    // Not saved, so the next visit follows the account again; this visit uses the choice.
  }
}

/**
 * This device's choice if it made one, otherwise the account's answer. Off until someone
 * says yes, on this device or to the smart features question.
 */
export function faceGroupingOn(
  device: FacePreference,
  account: SmartFeaturesChoice | null,
): boolean {
  if (device !== null) return device === 'on';
  return account?.choice === 'on';
}
