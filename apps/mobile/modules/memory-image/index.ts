import { requireNativeModule, requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';

interface MemoryImageModule {
  /** Keeps a copy of decrypted image bytes in memory and returns an id to show them by. */
  put(bytes: Uint8Array): string;
  /** Forgets an image and wipes its bytes. */
  release(id: string): void;
  /** Forgets every image. */
  clear(): void;
}

/**
 * Decrypted images, held in native memory only (never on disk): the phone's version of the
 * web app's object URLs.
 */
export const MemoryImages = requireNativeModule<MemoryImageModule>('ArcafoldMemoryImage');

/** Shows an image MemoryImages holds, cropped to fill the view. */
export const MemoryImage = requireNativeView<ViewProps & { imageId: string | null }>(
  'ArcafoldMemoryImage',
);
