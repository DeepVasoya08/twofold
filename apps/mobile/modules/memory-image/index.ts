import { requireNativeModule, requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';

interface MemoryImageModule {
  /** Keeps a copy of decrypted image bytes in memory and returns an id to show them by. */
  put(bytes: Uint8Array): string;
  /** Forgets an image and wipes its bytes. */
  release(id: string): void;
  /** Forgets every image. */
  clear(): void;
  /** An image's width and height, upright. Rejects for bytes that aren't a picture. */
  sizeAsync(id: string): Promise<{ width: number; height: number }>;
  /**
   * RGBA pixels of a size × size black square with the image drawn on it through `transform`
   * (a canvas setTransform's a, b, c, d, e, f), for the AI models; `smooth` shrinks well.
   */
  drawAsync(id: string, size: number, transform: number[], smooth: boolean): Promise<ArrayBuffer>;
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
  /** A picture that arrives comes into focus from a soft blur instead of appearing at once. */
  reveal?: boolean;
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
  /** When it was last changed, in milliseconds; 0 when Android doesn't say. */
  modified: number;
}

/** How a request to delete photos from the phone went. */
export interface DeleteResult {
  /** Deleted from the phone. */
  deleted: number;
  /** Still on the phone: you said no, or Android can't delete them (a cloud service's). */
  kept: number;
}

interface PhotoPickerModule {
  /** Opens Android's photo picker; resolves with what was picked (none if cancelled). */
  pickAsync(): Promise<PickedPhoto[]>;
  /** Opens Android's file picker, for any kind of file; none if cancelled. */
  pickFilesAsync(): Promise<PickedPhoto[]>;
  /** A JPEG of a picked PDF's first page, made in memory; null if it can't be drawn. */
  pdfPreviewAsync(uri: string, maxSide: number, quality: number): Promise<ArrayBuffer | null>;
  /** The photo's own bytes, untouched. */
  readAsync(uri: string): Promise<ArrayBuffer>;
  /** A JPEG preview made in memory, upright, and the photo's own width and height. */
  previewAsync(
    uri: string,
    maxSide: number,
    quality: number,
  ): Promise<{ thumb: ArrayBuffer; width: number; height: number }>;
  /** Asks Android to delete picked photos from the phone; it shows them and asks first. */
  deleteAsync(uris: readonly string[]): Promise<DeleteResult>;
}

/**
 * Android's own photo picker, and reading what it picked: no storage permission, only the
 * photos picked are visible to the app, and nothing is written to disk.
 */
export const PhotoPicker = requireNativeModule<PhotoPickerModule>('ArcafoldPhotoPicker');

/** A photo on the phone, as automatic backup finds it. */
export interface LibraryPhoto {
  /** MediaStore's id: photos added later have larger ones. */
  id: number;
  uri: string;
  name: string;
  type: string;
  /** Its size in bytes; 0 when Android doesn't say. */
  size: number;
}

interface PhotoLibraryModule {
  /** The newest photo's id, or 0 when there are none this app may see. */
  latestIdAsync(): Promise<number>;
  /** Photos with an id above `afterId`, oldest first, at most `limit` (up to 200). */
  listAsync(afterId: number, limit: number, cameraOnly: boolean): Promise<LibraryPhoto[]>;
}

/**
 * The phone's photos, listed for automatic backup (it needs the photos permission). They're
 * read like picked photos, with PhotoPicker's readAsync and previewAsync.
 */
export const PhotoLibrary = requireNativeModule<PhotoLibraryModule>('ArcafoldPhotoLibrary');
