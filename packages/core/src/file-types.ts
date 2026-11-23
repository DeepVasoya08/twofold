import { isPhotoType } from './photo-types';

/**
 * Files that aren't photos: what Arcafold keeps in Files, and how it names and labels them.
 * Videos are refused for now. Nothing here ever opens a file: names and types only.
 */

/** The longest file name kept, in characters, so sealed metadata stays small. */
export const MAX_FILE_NAME = 120;

/** What a file looks like on its tile: picks the icon colour and the label. */
export type FileKind =
  | 'pdf'
  | 'text'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'archive'
  | 'image'
  | 'audio'
  | 'other';

const VIDEO_EXTENSIONS = new Set([
  '3gp',
  'avi',
  'flv',
  'm2ts',
  'm4v',
  'mkv',
  'mov',
  'mp4',
  'mpeg',
  'mpg',
  'mts',
  'ogv',
  'webm',
  'wmv',
]);

/** Extensions browsers often send without a type, read as the photo formats they are. */
const PHOTO_EXTENSIONS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
};

const KIND_BY_EXTENSION: Record<string, FileKind> = {
  pdf: 'pdf',
  txt: 'text',
  md: 'text',
  markdown: 'text',
  csv: 'text',
  tsv: 'text',
  json: 'text',
  log: 'text',
  xml: 'text',
  yaml: 'text',
  yml: 'text',
  doc: 'document',
  docx: 'document',
  odt: 'document',
  rtf: 'document',
  pages: 'document',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  ods: 'spreadsheet',
  numbers: 'spreadsheet',
  ppt: 'presentation',
  pptx: 'presentation',
  odp: 'presentation',
  key: 'presentation',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
  svg: 'image',
  bmp: 'image',
  tif: 'image',
  tiff: 'image',
  psd: 'image',
  mp3: 'audio',
  m4a: 'audio',
  wav: 'audio',
  flac: 'audio',
  ogg: 'audio',
  aac: 'audio',
};

const KIND_LABEL: Record<FileKind, string> = {
  pdf: 'PDF',
  text: 'Text',
  document: 'Document',
  spreadsheet: 'Spreadsheet',
  presentation: 'Presentation',
  archive: 'Archive',
  image: 'Image',
  audio: 'Audio',
  other: 'File',
};

/** The extension of a file name, lower case and without the dot; empty if it has none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/** Whether a file is a video, which Arcafold doesn't take yet. */
export function isVideoFile(file: { type: string; name: string }): boolean {
  return (
    file.type.toLowerCase().startsWith('video/') || VIDEO_EXTENSIONS.has(fileExtension(file.name))
  );
}

/**
 * The photo format of a file, if it is one: its own type, or for a file the browser sent
 * without a type, the one its extension names. Null for anything that isn't a photo.
 */
export function photoTypeOf(file: { type: string; name: string }): string | null {
  if (isPhotoType(file.type)) return file.type.toLowerCase();
  if (file.type !== '') return null;
  return PHOTO_EXTENSIONS[fileExtension(file.name)] ?? null;
}

/** What a file is, from its type and then its extension. */
export function fileKindOf(type: string, name: string): FileKind {
  const lower = type.toLowerCase();
  if (lower === 'application/pdf') return 'pdf';
  const byExtension = KIND_BY_EXTENSION[fileExtension(name)];
  if (byExtension) return byExtension;
  if (lower.startsWith('text/')) return 'text';
  if (lower.startsWith('image/')) return 'image';
  if (lower.startsWith('audio/')) return 'audio';
  return 'other';
}

/** "PDF", "Spreadsheet" and so on, for a file's details. */
export function fileKindLabel(kind: FileKind): string {
  return KIND_LABEL[kind];
}

/**
 * A file name safe to keep and to save under: no folders, no control characters, and short
 * enough to seal, keeping its extension when it has to be cut.
 */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex -- control characters are what's removed
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const usable = cleaned === '' || cleaned === '.' || cleaned === '..' ? 'File' : cleaned;
  const chars = Array.from(usable);
  if (chars.length <= MAX_FILE_NAME) return usable;
  const extension = fileExtension(usable);
  const tail = extension.length > 0 && extension.length <= 10 ? `.${extension}` : '';
  return `${chars.slice(0, MAX_FILE_NAME - tail.length).join('')}${tail}`;
}

/** A media type that's safe to keep: the browser's, or a generic one if it sent none. */
export function cleanFileType(type: string): string {
  const lower = type.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,99}$/.test(lower)
    ? lower
    : 'application/octet-stream';
}

/** Smallest and largest stand-in preview, in bytes. */
const PLACEHOLDER_MIN = 16 * 1024;
const PLACEHOLDER_SPREAD = 32 * 1024;

/**
 * The stand-in kept as a file's preview until a real one is made. Every stored item has a
 * preview of a photo-like size, so the server can't pick out files by a missing or tiny one.
 * It is encrypted like any preview; the app never shows it.
 */
export function placeholderPreview(random: () => number = Math.random): Uint8Array<ArrayBuffer> {
  return new Uint8Array(PLACEHOLDER_MIN + Math.floor(random() * PLACEHOLDER_SPREAD));
}

/** Smallest stored preview, so a real one looks like any other (see placeholderPreview). */
export const PREVIEW_MIN_BYTES = 16 * 1024;

/**
 * A JPEG padded with zeros after its end, which image decoders ignore, up to `min` bytes:
 * so a small preview is as big as a stand-in one and the server can't tell them apart.
 */
export function padPreview(
  jpeg: Uint8Array<ArrayBuffer>,
  min: number = PREVIEW_MIN_BYTES,
): Uint8Array<ArrayBuffer> {
  if (jpeg.length >= min) return jpeg;
  const padded = new Uint8Array(min);
  padded.set(jpeg);
  return padded;
}

/** Whether bytes start like a JPEG: the only thing a file's preview may ever be. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
