import type { ViewStyle } from 'react-native';

/** A straight line from one point to another, as a rotated bar. */
export function segment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: number,
  color: string,
): ViewStyle {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return {
    position: 'absolute',
    left: (x1 + x2) / 2 - length / 2,
    top: (y1 + y2) / 2 - stroke / 2,
    width: length,
    height: stroke,
    borderRadius: stroke,
    backgroundColor: color,
    transform: [{ rotate: `${String(angle)}deg` }],
  };
}
