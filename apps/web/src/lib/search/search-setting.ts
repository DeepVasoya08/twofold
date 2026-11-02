/**
 * Whether this device works out search vectors. On unless turned off in Settings on this
 * device, kept in localStorage like face grouping. Either way it applies to whichever space
 * is open, so the main library can't show whether Smart search runs in another space.
 */
export const SEARCH_SETTING_KEY = 'arcafold.smartSearch';

export function loadSearchSetting(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return storage?.getItem(SEARCH_SETTING_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveSearchSetting(
  storage: Pick<Storage, 'setItem'> | undefined,
  on: boolean,
): void {
  try {
    storage?.setItem(SEARCH_SETTING_KEY, on ? 'on' : 'off');
  } catch {
    // Not saved, so the next visit is on again; this visit uses the choice.
  }
}
