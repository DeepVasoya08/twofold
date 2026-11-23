import { Image, StyleSheet, View } from 'react-native';

import archDay from '../../assets/arch-day.png';
import archNight from '../../assets/arch-night.png';
import { usePalette } from './theme';

/**
 * The logo mark, as on the web (components/Brand.tsx): an arch with a smaller arch inside it,
 * a private space within your library. Drawn with views so it takes the palette's colours.
 * `size` is its height; `behind` is the colour it sits on, which shows through the doorway.
 */
export function LogoMark({ size = 28, behind }: { size?: number; behind?: string }) {
  const palette = usePalette();
  // The mark is 20 by 24.5 units: the outer arch's radius is 10, the doorway's 4.5 and the
  // inner arch's 2.5.
  const unit = size / 24.5;
  const at = (n: number) => n * unit;
  return (
    <View style={{ width: at(20), height: size }} accessible={false}>
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: palette.accent,
            borderTopLeftRadius: at(10),
            borderTopRightRadius: at(10),
          },
        ]}
      />
      <View
        style={{
          position: 'absolute',
          left: at(5.5),
          top: at(11),
          width: at(9),
          height: at(13.5),
          backgroundColor: behind ?? palette.background,
          borderTopLeftRadius: at(4.5),
          borderTopRightRadius: at(4.5),
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: at(7.5),
          top: at(13.4),
          width: at(5),
          height: at(11.1),
          backgroundColor: palette.accentSoft,
          borderTopLeftRadius: at(2.5),
          borderTopRightRadius: at(2.5),
        }}
      />
    </View>
  );
}

/**
 * Arcafold's own artwork for the sign-in and lock screens, never a user's photo: nothing is
 * decrypted before unlocking, and the screen must look the same whichever password comes
 * next. A day arch for the library, with a small night arch tucked into its corner.
 */
export function ArchArt({ width = 132 }: { width?: number }) {
  const palette = usePalette();
  const height = width * 1.25;
  const night = width * 0.42;
  return (
    <View style={{ width, height }} accessible={false}>
      <Image
        source={archDay}
        style={{
          width,
          height,
          borderTopLeftRadius: width / 2,
          borderTopRightRadius: width / 2,
          borderBottomLeftRadius: 14,
          borderBottomRightRadius: 14,
        }}
        resizeMode="cover"
      />
      <Image
        source={archNight}
        style={{
          position: 'absolute',
          right: -night * 0.34,
          bottom: -night * 0.14,
          width: night,
          height: night * 1.25,
          borderWidth: 4,
          borderColor: palette.background,
          borderTopLeftRadius: night / 2,
          borderTopRightRadius: night / 2,
          borderBottomLeftRadius: 9,
          borderBottomRightRadius: 9,
        }}
        resizeMode="cover"
      />
    </View>
  );
}
