import { STORAGE_SIZES } from '@arcafold/types';

import { FormError } from '@arcafold/core/errors';
import {
  cleanFileName,
  cleanFileType,
  fileKindOf,
  isJpeg,
  padPreview,
  photoTypeOf,
  placeholderPreview,
} from '@arcafold/core/file-types';
import type { NewPhoto } from '@arcafold/core/library/space-store';
import { fileDate, photoTakenAt } from '@arcafold/core/photo-date';

/** Previews are the same size and quality as the web app's, so both look alike. */
export const PREVIEW_MAX_SIDE = 640;
export const PREVIEW_QUALITY = 82;
/** A PDF's first page is drawn this big on its longer side, as the web draws it. */
export const PAGE_PREVIEW_SIDE = 480;

/** A photo picked from the phone, before it's read. */
export interface PickedSource {
  uri: string;
  name: string;
  type: string;
  size: number;
  /** When a picked file was last changed, in milliseconds (0 if unknown): its date. */
  modified?: number;
}

/** Reads picked photos, in memory only (the native photo picker). */
export interface PhotoReader {
  readAsync: (uri: string) => Promise<ArrayBuffer>;
  previewAsync: (
    uri: string,
    maxSide: number,
    quality: number,
  ) => Promise<{ thumb: ArrayBuffer; width: number; height: number }>;
  /** A JPEG of a PDF's first page; null if it can't be drawn. */
  pdfPreviewAsync: (uri: string, maxSide: number, quality: number) => Promise<ArrayBuffer | null>;
}

const LARGEST_MB = String(Math.floor(STORAGE_SIZES.maxFull / (1024 * 1024)) - 1);
export const FILE_TOO_LARGE = `That file is too large. Arcafold takes files up to ${LARGEST_MB} MB.`;

/**
 * Reads a picked photo into what the library stores: its own bytes, untouched, and a JPEG
 * preview made on the phone. The date it was taken comes from the photo itself. Anything
 * that isn't a photo is kept as a file (prepareFile).
 */
export async function preparePicked(
  source: PickedSource,
  reader: PhotoReader,
  now: number = Date.now(),
): Promise<NewPhoto> {
  const type = photoTypeOf(source);
  if (type === null) return prepareFile(source, reader, now);
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

/**
 * Reads a picked file that isn't a photo, the way the web adds one: its own bytes and name,
 * dated when it was last changed. A PDF's first page becomes its preview; anything else
 * gets a stand-in, so the server can't tell files from photos. Files added from the phone
 * aren't sorted into categories (they show under Other until you sort them on the web).
 */
export async function prepareFile(
  source: PickedSource,
  reader: PhotoReader,
  now: number = Date.now(),
): Promise<NewPhoto> {
  if (source.size > STORAGE_SIZES.maxFull) throw new FormError(FILE_TOO_LARGE);
  const name = cleanFileName(source.name);
  const type = cleanFileType(source.type);
  const page =
    fileKindOf(type, name) === 'pdf'
      ? await reader
          .pdfPreviewAsync(source.uri, PAGE_PREVIEW_SIDE, PREVIEW_QUALITY)
          .catch(() => null)
      : null;
  const drawn = page && isJpeg(new Uint8Array(page)) ? padPreview(new Uint8Array(page)) : null;
  const full = new Uint8Array(await reader.readAsync(source.uri));
  return {
    thumb: drawn ?? placeholderPreview(),
    full,
    type,
    width: 0,
    height: 0,
    takenAt: fileDate(source.modified ?? 0, now),
    file: { name, ...(drawn && { preview: true }) },
  };
}
