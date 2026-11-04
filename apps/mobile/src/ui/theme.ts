import { useColorScheme } from 'react-native';

import { colors } from '../theme';

export type Palette = (typeof colors)['dark'] | (typeof colors)['light'];

/** The palette for the phone's light or dark setting. */
export function usePalette(): Palette {
  return useColorScheme() === 'light' ? colors.light : colors.dark;
}
