/**
 * The photo formats Twofold stores. Only raster formats: an SVG is a document that can carry
 * script, so it is never stored or turned into an object URL.
 */
export const PHOTO_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
];

export const PHOTO_TYPES_TEXT = 'JPEG, PNG, GIF, WebP, HEIC and AVIF';

export function isPhotoType(type: string): boolean {
  return PHOTO_TYPES.includes(type.toLowerCase());
}

/** A file name extension for one of the photo formats, for naming copies sent elsewhere. */
export function extensionOf(type: string): string {
  const subtype = type.toLowerCase().split('/')[1] ?? '';
  if (subtype === 'jpeg') return 'jpg';
  return isPhotoType(type) ? subtype : 'bin';
}
