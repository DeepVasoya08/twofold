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

interface MemoryImageProps extends ViewProps {
  imageId: string | null;
  /** "cover" crops to fill the view (the default); "contain" shows the whole picture. */
  fit?: 'cover' | 'contain';
  /** Decodes no larger than this many pixels on the longer side (default 512). */
  maxSide?: number;
}

/** Shows an image MemoryImages holds, decoded at the size it's shown and turned upright. */
export const MemoryImage = requireNativeView<MemoryImageProps>('ArcafoldMemoryImage');
