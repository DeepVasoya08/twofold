import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { segment } from './segment';

/**
 * Line icons drawn with views, so they take any colour and need no icon font or emoji (which
 * Android draws in colour, in its own style). Each fits a `size` square with a stroke of
 * about a twelfth of it, like the web's icons.
 */
export type IconName =
  | 'search'
  | 'photos'
  | 'albums'
  | 'files'
  | 'people'
  | 'upload'
  | 'plus'
  | 'grid'
  | 'compact'
  | 'uncropped'
  | 'check'
  | 'back'
  | 'more'
  | 'heart'
  | 'download'
  | 'similar'
  | 'lock'
  | 'unlock'
  | 'trash'
  | 'clock'
  | 'signal'
  | 'phone'
  | 'theme';

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
    case 'upload':
      // An arrow up out of a tray.
      parts = [
        segment(at(12), at(3.5), at(12), at(15), stroke, color),
        segment(at(7), at(8.5), at(12), at(3.5), stroke, color),
        segment(at(12), at(3.5), at(17), at(8.5), stroke, color),
        {
          ...line,
          left: at(4),
          top: at(13),
          width: at(16),
          height: at(8),
          borderTopWidth: 0,
          borderBottomLeftRadius: at(2.5),
          borderBottomRightRadius: at(2.5),
        },
      ];
      break;
    case 'grid':
    case 'compact': {
      const across = name === 'grid' ? 2 : 3;
      const cell = (18 - (across - 1) * 2) / across;
      parts = [];
      for (let row = 0; row < across; row += 1) {
        for (let column = 0; column < across; column += 1) {
          parts.push({
            position: 'absolute',
            left: at(3 + column * (cell + 2)),
            top: at(3 + row * (cell + 2)),
            width: at(cell),
            height: at(cell),
            borderRadius: at(1.5),
            backgroundColor: color,
          });
        }
      }
      break;
    }
    case 'uncropped':
      // Rows of differently shaped tiles.
      parts = [
        [3, 4, 10.5],
        [15.5, 4, 5.5],
        [3, 13, 6],
        [11, 13, 10],
      ].map(([left = 0, top = 0, width = 0]) => ({
        position: 'absolute' as const,
        left: at(left),
        top: at(top),
        width: at(width),
        height: at(7),
        borderRadius: at(1.5),
        backgroundColor: color,
      }));
      break;
    case 'plus':
      parts = [
        segment(at(12), at(4.5), at(12), at(19.5), stroke, color),
        segment(at(4.5), at(12), at(19.5), at(12), stroke, color),
      ];
      break;
    case 'back':
      parts = [
        segment(at(15), at(5), at(8), at(12), stroke, color),
        segment(at(8), at(12), at(15), at(19), stroke, color),
      ];
      break;
    case 'more':
      parts = [5, 12, 19].map((x) => ({
        position: 'absolute' as const,
        left: at(x - 2),
        top: at(10),
        width: at(4),
        height: at(4),
        borderRadius: at(2),
        backgroundColor: color,
      }));
      break;
    case 'heart': {
      // Filled: two round lobes over a square turned on its corner.
      const lobe = at(9.5);
      const fill = { position: 'absolute' as const, backgroundColor: color };
      parts = [
        {
          ...fill,
          left: at(6.6),
          top: at(7.4),
          width: at(10.8),
          height: at(10.8),
          borderRadius: at(1.5),
          transform: [{ rotate: '45deg' }],
        },
        { ...fill, left: at(2.6), top: at(4), width: lobe, height: lobe, borderRadius: lobe / 2 },
        { ...fill, left: at(11.9), top: at(4), width: lobe, height: lobe, borderRadius: lobe / 2 },
      ];
      break;
    }
    case 'download':
      // An arrow down into a tray.
      parts = [
        segment(at(12), at(3.5), at(12), at(15), stroke, color),
        segment(at(7), at(10), at(12), at(15), stroke, color),
        segment(at(12), at(15), at(17), at(10), stroke, color),
        {
          ...line,
          left: at(4),
          top: at(13),
          width: at(16),
          height: at(8),
          borderTopWidth: 0,
          borderBottomLeftRadius: at(2.5),
          borderBottomRightRadius: at(2.5),
        },
      ];
      break;
    case 'similar':
      // Two photos alike: one frame over another, offset.
      parts = [
        { ...line, left: at(2.5), top: at(7), width: at(13), height: at(13), borderRadius: at(3) },
        {
          ...line,
          left: at(8.5),
          top: at(2.5),
          width: at(13),
          height: at(13),
          borderRadius: at(3),
        },
      ];
      break;
    case 'lock':
    case 'unlock':
      parts = [
        {
          ...line,
          left: name === 'lock' ? at(7.5) : at(10.5),
          top: name === 'lock' ? at(2.5) : at(1),
          width: at(9),
          height: at(10),
          borderBottomWidth: 0,
          borderTopLeftRadius: at(4.5),
          borderTopRightRadius: at(4.5),
        },
        {
          ...line,
          left: at(4.5),
          top: at(10.5),
          width: at(15),
          height: at(11),
          borderRadius: at(2.5),
        },
      ];
      break;
    case 'trash':
      parts = [
        segment(at(3.5), at(6.5), at(20.5), at(6.5), stroke, color),
        {
          ...line,
          left: at(9),
          top: at(2.5),
          width: at(6),
          height: at(4.5),
          borderBottomWidth: 0,
          borderTopLeftRadius: at(1.5),
          borderTopRightRadius: at(1.5),
        },
        {
          ...line,
          left: at(5.5),
          top: at(6.5),
          width: at(13),
          height: at(15),
          borderTopWidth: 0,
          borderBottomLeftRadius: at(2.5),
          borderBottomRightRadius: at(2.5),
        },
      ];
      break;
    case 'clock':
      parts = [
        { ...line, left: at(3), top: at(3), width: at(18), height: at(18), borderRadius: at(9) },
        segment(at(12), at(7), at(12), at(12.5), stroke, color),
        segment(at(12), at(12.5), at(15.5), at(14.5), stroke, color),
      ];
      break;
    case 'signal':
      parts = [
        [4, 15],
        [9, 11],
        [14, 7],
        [19, 3],
      ].map(([x = 0, top = 0]) => ({
        position: 'absolute' as const,
        left: at(x - 1.5),
        top: at(top),
        width: at(3),
        height: at(21 - top),
        borderRadius: at(1.5),
        backgroundColor: color,
      }));
      break;
    case 'phone':
      parts = [
        {
          ...line,
          left: at(6.5),
          top: at(2.5),
          width: at(11),
          height: at(19),
          borderRadius: at(2.5),
        },
        segment(at(10.5), at(18), at(13.5), at(18), stroke, color),
      ];
      break;
    case 'theme':
      // A circle, half filled: light and dark.
      parts = [
        { ...line, left: at(3), top: at(3), width: at(18), height: at(18), borderRadius: at(9) },
        {
          position: 'absolute',
          left: at(3),
          top: at(3),
          width: at(9),
          height: at(18),
          borderTopLeftRadius: at(9),
          borderBottomLeftRadius: at(9),
          backgroundColor: color,
        },
      ];
      break;
    case 'check':
      parts = [
        segment(at(4.5), at(12.5), at(9.5), at(17.5), stroke, color),
        segment(at(9.5), at(17.5), at(19.5), at(6.5), stroke, color),
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
