import { FormError } from '@arcafold/core/errors';
import { photoTypeOf } from '@arcafold/core/file-types';
import type { NewPhoto } from '@arcafold/core/library/space-store';
import { photoTakenAt } from '@arcafold/core/photo-date';

/** Previews are the same size and quality as the web app's, so both look alike. */
export const PREVIEW_MAX_SIDE = 640;
export const PREVIEW_QUALITY = 82;

/** A photo picked from the phone, before it's read. */
export interface PickedSource {
  uri: string;
  name: string;
  type: string;
  size: number;
}

/** Reads picked photos, in memory only (the native photo picker). */
export interface PhotoReader {
  readAsync: (uri: string) => Promise<ArrayBuffer>;
  previewAsync: (
    uri: string,
    maxSide: number,
    quality: number,
  ) => Promise<{ thumb: ArrayBuffer; width: number; height: number }>;
}

export const NOT_A_PHOTO = 'Only photos can be added from this phone for now.';

/**
 * Reads a picked photo into what the library stores: its own bytes, untouched, and a JPEG
 * preview made on the phone. The date it was taken comes from the photo itself.
 */
export async function preparePicked(
  source: PickedSource,
  reader: PhotoReader,
  now: number = Date.now(),
): Promise<NewPhoto> {
  const type = photoTypeOf(source);
  if (type === null) throw new FormError(NOT_A_PHOTO);
  let preview;
  try {
    preview = await reader.previewAsync(source.uri, PREVIEW_MAX_SIDE, PREVIEW_QUALITY);
  } catch {
    throw new FormError('Arcafold can’t read this image.');
  }
  const full = new Uint8Array(await reader.readAsync(source.uri));
  return {
    thumb: new Uint8Array(preview.thumb),
    full,
    type,
    width: preview.width,
    height: preview.height,
    takenAt: photoTakenAt(full, 0, now),
  };
}
