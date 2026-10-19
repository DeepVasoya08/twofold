/**
 * Makes the small square JPEG used as a profile photo, entirely in memory. It is encrypted
 * before upload like any photo.
 */

export const PROFILE_SIDE = 256;
const PROFILE_QUALITY = 0.85;

/** The centred square to crop from a `width`×`height` image. */
export function centerSquare(
  width: number,
  height: number,
): { x: number; y: number; side: number } {
  const side = Math.min(width, height);
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), side };
}

/** Returns null if the browser can't decode the image. */
export async function makeProfileImage(file: Blob): Promise<Uint8Array<ArrayBuffer> | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const crop = centerSquare(bitmap.width, bitmap.height);
    const side = Math.min(PROFILE_SIDE, crop.side);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, crop.x, crop.y, crop.side, crop.side, 0, 0, side, side);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', PROFILE_QUALITY);
    });
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } finally {
    bitmap.close();
  }
}
