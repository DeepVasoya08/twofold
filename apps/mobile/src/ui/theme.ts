import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { useAccount } from '../session/account';
import { colors, privateColors } from '../theme';
import type { Palette } from '../theme';

export type { Palette };

/** The palette for the phone's light or dark setting, in violet while the private space is open. */
export function usePalette(): Palette {
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark';
  const { space } = useAccount();
  return useMemo(
    () => (space === 'private' ? { ...colors[scheme], ...privateColors[scheme] } : colors[scheme]),
    [scheme, space],
  );
}
