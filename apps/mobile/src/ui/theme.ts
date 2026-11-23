import { useColorScheme } from 'react-native';

import { useAccount } from '../session/account';
import { colors, nightColors } from '../theme';
import type { Palette } from '../theme';

export type { Palette };

/** The palette for the phone's light or dark setting, or night while the private space is open. */
export function usePalette(): Palette {
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark';
  const { space } = useAccount();
  return space === 'private' ? nightColors : colors[scheme];
}
