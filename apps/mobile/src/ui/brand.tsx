import { Image, View } from 'react-native';

import archDay from '../../assets/arch-day.png';
import archNight from '../../assets/arch-night.png';
import { usePalette } from './theme';

/**
 * The logo mark, as on the web (components/Brand.tsx): two arches folded over each other,
 * your library with a private space tucked in front. Drawn with views so it takes the
 * palette's colours. `size` is its height; `behind` is the colour it sits on, which draws the
 * thin gap between the arches.
 */
export function LogoMark({ size = 28, behind }: { size?: number; behind?: string }) {
  const palette = usePalette();
  // A 28-unit square: the back arch is 16 wide and 22 tall, the front one 16 by 18, both
  // with round tops, and the gap between them 1.5 units.
  const unit = size / 28;
  const at = (n: number) => n * unit;
  const gap = at(1.5);
  return (
    <View style={{ width: size, height: size }} accessible={false}>
      <View
        style={{
          position: 'absolute',
          left: at(1),
          top: at(3),
          width: at(16),
          height: at(22),
          backgroundColor: palette.accent,
          borderTopLeftRadius: at(8),
          borderTopRightRadius: at(8),
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: at(11) - gap,
          top: at(7) - gap,
          width: at(16) + gap * 2,
          height: at(18) + gap,
          backgroundColor: palette.text,
          borderColor: behind ?? palette.background,
          borderWidth: gap,
          borderBottomWidth: 0,
          borderTopLeftRadius: at(8) + gap,
          borderTopRightRadius: at(8) + gap,
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
