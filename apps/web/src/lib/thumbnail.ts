/**
 * Makes the small JPEG preview stored next to each photo, entirely in memory. The preview is
 * encrypted before upload like the original.
 */

export const THUMB_MAX_SIDE = 640;
const THUMB_QUALITY = 0.82;

export interface Thumbnail {
  bytes: Uint8Array<ArrayBuffer>;
  /** The original's size in pixels. */
  width: number;
  height: number;
}

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

/** Returns null if the browser can't decode the image. */
export async function makeThumbnail(file: Blob): Promise<Thumbnail | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height, THUMB_MAX_SIDE);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', THUMB_QUALITY);
    });
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
