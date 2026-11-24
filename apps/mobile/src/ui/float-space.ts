import { createContext, useContext, useEffect } from 'react';

/**
 * How far the tab bar and the floating buttons reach up from the bottom of a tab's screen.
 * They float over the screen, so its list leaves this much room at the end to scroll the
 * last row clear of them. Zero on pages without the tab bar.
 */
export const FloatSpace = createContext(0);

export function useFloatSpace(): number {
  return useContext(FloatSpace);
}

/**
 * Tells Home when a tab is selecting or has a sheet open (`picking`), so the floating tab bar
 * and Add button step aside for it, and that it's done when the tab closes.
 */
export function useReportPicking(picking: boolean, onPicking?: (picking: boolean) => void): void {
  useEffect(() => {
    onPicking?.(picking);
  }, [picking, onPicking]);
  useEffect(
    () => () => {
      onPicking?.(false);
    },
    [onPicking],
  );
}
