import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { segment } from './segment';

/**
 * Line icons drawn with views, so they take any colour and need no icon font or emoji (which
 * Android draws in colour, in its own style). Each fits a `size` square with a stroke of
 * about a twelfth of it, like the web's icons.
 */
export type IconName = 'search' | 'photos' | 'albums' | 'files' | 'people';

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color: string }) {
  const stroke = Math.max(1.5, Math.round((size / 12) * 2) / 2);
  const at = (n: number) => (n / 24) * size;
  const line: ViewStyle = { position: 'absolute', borderColor: color, borderWidth: stroke };
  let parts: ViewStyle[];
  switch (name) {
    case 'search':
      parts = [
        { ...line, left: at(3), top: at(3), width: at(14), height: at(14), borderRadius: at(7) },
        segment(at(15), at(15), at(21), at(21), stroke, color),
      ];
      break;
    case 'photos':
      // A frame with a sun in its corner and a hill along the bottom.
      parts = [
        { ...line, left: at(3), top: at(4), width: at(18), height: at(16), borderRadius: at(3) },
        {
          position: 'absolute',
          left: at(14),
          top: at(7.5),
          width: at(3.4),
          height: at(3.4),
          borderRadius: at(1.7),
          backgroundColor: color,
        },
        segment(at(4), at(17), at(9.5), at(11.5), stroke, color),
        segment(at(9.5), at(11.5), at(17), at(19), stroke, color),
      ];
      break;
    case 'albums':
      // An arch, like the album covers, with a sun inside.
      parts = [
        {
          ...line,
          left: at(4.5),
          top: at(2.5),
          width: at(15),
          height: at(19),
          borderTopLeftRadius: at(7.5),
          borderTopRightRadius: at(7.5),
          borderBottomLeftRadius: at(2.5),
          borderBottomRightRadius: at(2.5),
        },
        {
          position: 'absolute',
          left: at(10.2),
          top: at(9),
          width: at(3.6),
          height: at(3.6),
          borderRadius: at(1.8),
          backgroundColor: color,
        },
      ];
      break;
    case 'files':
      parts = [
        {
          ...line,
          left: at(5),
          top: at(2.5),
          width: at(14),
          height: at(19),
          borderRadius: at(2.5),
        },
        {
          position: 'absolute',
          left: at(8.5),
          top: at(8.5),
          width: at(7),
          height: stroke,
          backgroundColor: color,
          borderRadius: stroke,
        },
        {
          position: 'absolute',
          left: at(8.5),
          top: at(12.5),
          width: at(7),
          height: stroke,
          backgroundColor: color,
          borderRadius: stroke,
        },
        {
          position: 'absolute',
          left: at(8.5),
          top: at(16.5),
          width: at(4.5),
          height: stroke,
          backgroundColor: color,
          borderRadius: stroke,
        },
      ];
      break;
    case 'people':
      parts = [
        {
          ...line,
          left: at(7.5),
          top: at(2.5),
          width: at(9),
          height: at(9),
          borderRadius: at(4.5),
        },
        {
          ...line,
          left: at(3.5),
          top: at(13.5),
          width: at(17),
          height: at(8),
          borderTopLeftRadius: at(8.5),
          borderTopRightRadius: at(8.5),
          borderBottomLeftRadius: at(1.5),
          borderBottomRightRadius: at(1.5),
        },
      ];
      break;
  }
  return (
    <View style={{ width: size, height: size }} accessible={false} pointerEvents="none">
      {parts.map((style, index) => (
        <View key={index} style={style} />
      ))}
    </View>
  );
}
