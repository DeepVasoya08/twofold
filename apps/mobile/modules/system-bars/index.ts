import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';

interface SystemBarsModule {
  bottomInset(): number;
}

const native =
  Platform.OS === 'android' ? requireNativeModule<SystemBarsModule>('ArcafoldSystemBars') : null;

/**
 * How far up from the bottom edge Android's navigation bar reaches, in points. Arcafold draws
 * edge to edge, so anything along the bottom pads itself by this much. 0 before the window
 * has insets.
 */
export function bottomInset(): number {
  try {
    return native?.bottomInset() ?? 0;
  } catch {
    return 0;
  }
}
