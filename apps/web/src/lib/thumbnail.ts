/**
 * Makes the small JPEG preview stored next to each photo, entirely in memory. The preview is
 * encrypted before upload like the original. Decoding a camera photo and scaling it down is
 * the heaviest step of an upload, so it runs in a Web Worker when the browser can draw there
 * (lib/thumbnailer.ts), and on the page otherwise.
 */

import { decodeHeif, isHeif } from './heif';

export const THUMB_MAX_SIDE = 640;
const THUMB_QUALITY = 0.82;

export interface Thumbnail {
  bytes: Uint8Array<ArrayBuffer>;
  /** The original's size in pixels. */
  width: number;
  height: number;
}

/** A canvas to draw a preview on: one on the page, or an OffscreenCanvas in a worker. */
export interface ThumbCanvas {
  draw: (image: ImageBitmap, width: number, height: number) => boolean;
  toJpeg: (quality: number) => Promise<Blob | null>;
}

export type CanvasMaker = (width: number, height: number) => ThumbCanvas;

/** Fits `width`×`height` inside a square of `max`, never scaling up. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Opens a photo for drawing. Browsers decode most formats themselves; a HEIC photo that this
 * one can't is decoded with libheif instead (lib/heif.ts). Null if it can't be read.
 */
async function openImage(file: Blob): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file);
  } catch {
    // Not a format this browser reads; HEIC is the one worth a second try.
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isHeif(bytes)) return null;
  try {
    const pixels = await decodeHeif(bytes);
    if (!pixels) return null;
    return await createImageBitmap(new ImageData(pixels.data, pixels.width, pixels.height));
  } catch {
    return null;
  }
}

/**
 * Draws a JPEG copy, no bigger than `maxSide` on its longer side, on a canvas from
 * `makeCanvas`: the preview by default. Null if the image can't be read.
 */
export async function drawThumbnail(
  file: Blob,
  makeCanvas: CanvasMaker,
  maxSide: number = THUMB_MAX_SIDE,
): Promise<Thumbnail | null> {
  const bitmap = await openImage(file);
  if (!bitmap) return null;
  try {
    const size = fitWithin(bitmap.width, bitmap.height, maxSide);
    const canvas = makeCanvas(size.width, size.height);
    if (!canvas.draw(bitmap, size.width, size.height)) return null;
    const blob = await canvas.toJpeg(THUMB_QUALITY);
    if (!blob) return null;
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

/** A canvas element on the page. */
export const pageCanvas: CanvasMaker = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return {
    draw: (image, w, h) => {
      const context = canvas.getContext('2d');
      if (!context) return false;
      context.drawImage(image, 0, 0, w, h);
      return true;
    },
    toJpeg: (quality) =>
      new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', quality);
      }),
  };
};

/** An OffscreenCanvas, for drawing inside a worker. */
export const offscreenCanvas: CanvasMaker = (width, height) => {
  const canvas = new OffscreenCanvas(width, height);
  return {
    draw: (image, w, h) => {
      const context = canvas.getContext('2d');
      if (!context) return false;
      context.drawImage(image, 0, 0, w, h);
      return true;
    },
    toJpeg: (quality) => canvas.convertToBlob({ type: 'image/jpeg', quality }).catch(() => null),
  };
};
