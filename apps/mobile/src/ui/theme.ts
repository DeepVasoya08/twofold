import { useColorScheme } from 'react-native';

import { useAccount } from '../session/account';
import { useAppearance } from './appearance';
import { schemeFor } from './appearance-settings';
import { colors, nightColors } from '../theme';
import type { Palette } from '../theme';

export type { Palette };

/**
 * The palette for the theme chosen in Settings (or the phone's light or dark setting), or
 * night while the private space is open.
 */
export function usePalette(): Palette {
  const scheme = schemeFor(useAppearance().theme, useColorScheme());
  const { space } = useAccount();
  return space === 'private' ? nightColors : colors[scheme];
}
