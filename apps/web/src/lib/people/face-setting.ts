/**
 * Whether this device finds faces. It's a plain preference for this browser, kept in
 * localStorage like auto-lock, and it applies to whichever space is open. Keeping it per
 * device rather than per space means the main library can't show that face grouping was
 * turned on in another space: the setting and the downloaded models look the same either way.
 */

export const FACE_SETTING_KEY = 'twofold.faceGrouping';

/** Off unless turned on here. Storage that's missing or blocked counts as off. */
export function loadFaceSetting(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return storage?.getItem(FACE_SETTING_KEY) === 'on';
  } catch {
    return false;
  }
}

export function saveFaceSetting(storage: Pick<Storage, 'setItem'> | undefined, on: boolean): void {
  try {
    storage?.setItem(FACE_SETTING_KEY, on ? 'on' : 'off');
  } catch {
    // Not saved, so the next visit starts off; this visit still uses the choice.
  }
}
