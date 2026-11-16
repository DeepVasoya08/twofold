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
  /**
   * Pinch, double-tap and pan to zoom (the viewer). The view then handles its own touches:
   * a single tap reaches `onTap`, and `onZoom` says when it's zoomed in or back out.
   */
  zoomable?: boolean;
  onTap?: () => void;
  onZoom?: (event: { nativeEvent: { zoomed: boolean } }) => void;
}

/** Shows an image MemoryImages holds, decoded at the size it's shown and turned upright. */
export const MemoryImage = requireNativeView<MemoryImageProps>('ArcafoldMemoryImage');

/** A photo picked from the phone's gallery, before it's read. */
export interface PickedPhoto {
  /** Where Android lets the app read it from, for as long as the app runs. */
  uri: string;
  name: string;
  type: string;
  /** Its size in bytes; 0 when Android doesn't say. */
  size: number;
}

interface PhotoPickerModule {
  /** Opens Android's photo picker; resolves with what was picked (none if cancelled). */
  pickAsync(): Promise<PickedPhoto[]>;
  /** The photo's own bytes, untouched. */
  readAsync(uri: string): Promise<ArrayBuffer>;
  /** A JPEG preview made in memory, upright, and the photo's own width and height. */
  previewAsync(
    uri: string,
    maxSide: number,
    quality: number,
  ): Promise<{ thumb: ArrayBuffer; width: number; height: number }>;
}

/**
 * Android's own photo picker, and reading what it picked: no storage permission, only the
 * photos picked are visible to the app, and nothing is written to disk.
 */
export const PhotoPicker = requireNativeModule<PhotoPickerModule>('ArcafoldPhotoPicker');
