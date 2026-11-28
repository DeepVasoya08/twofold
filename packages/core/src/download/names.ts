import { fileExtension } from '../file-types';
import { extensionOf } from '../photo-types';

/**
 * Names for photos saved to the device: when each was taken, in the device's time zone,
 * like a camera roll. Names never say which space or album a photo came from.
 */

const pad = (value: number) => String(value).padStart(2, '0');

function localDate(date: Date): string {
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `2026-10-19 14.32.05`, or `Photo` for a date that doesn't parse. */
export function takenName(takenAt: string): string {
  const date = new Date(takenAt);
  if (Number.isNaN(date.getTime())) return 'Photo';
  const time = `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
  return `${localDate(date)} ${time}`;
}

/**
 * The name of a photo saved straight from the viewer, which hands the browser the decrypted
 * original as it is: when it was taken, without dots (`2026-10-19 14-32-05`), so that the
 * browser adds the extension of the file's own type. Never anything that names the photo,
 * like its id.
 */
export function viewerSaveName(takenAt: string): string {
  return takenName(takenAt).replace(/\./g, '-');
}

/** A file's own name split into its base and extension (without the dot). */
function splitName(name: string): { base: string; extension: string } {
  const length = fileExtension(name).length;
  if (length === 0) return { base: name, extension: '' };
  return { base: name.slice(0, name.length - length - 1), extension: name.slice(-length) };
}

/** What a saved copy is named from. */
export interface CopyDetails {
  takenAt: string;
  type: string;
  /** A file's own name (not a photo's). */
  name?: string;
}

function nameParts({ takenAt, type, name: own }: CopyDetails): { base: string; extension: string } {
  return own === undefined
    ? { base: takenName(takenAt), extension: extensionOf(type) }
    : splitName(own);
}

/**
 * One copy's name, for saving where the device itself keeps names apart (the phone's
 * gallery adds its own ` (1)`): when it was taken with its type's extension, or a file's
 * own name.
 */
export function copyName(details: CopyDetails): string {
  const { base, extension } = nameParts(details);
  return extension === '' ? base : `${base}.${extension}`;
}

/**
 * Names a batch of photos by when they were taken, with the extension of their type; a file
 * (not a photo) keeps its own `name`. Names that would clash get ` (2)`, ` (3)` and so on,
 * so every name is different.
 */
export function copyNames(photos: readonly CopyDetails[]): string[] {
  const used = new Set<string>();
  return photos.map((details) => {
    const { base, extension } = nameParts(details);
    const join = (stem: string) => (extension === '' ? stem : `${stem}.${extension}`);
    let name = join(base);
    for (let n = 2; used.has(name.toLowerCase()); n += 1) {
      name = join(`${base} (${String(n)})`);
    }
    used.add(name.toLowerCase());
    return name;
  });
}

/** The name of a zip of photos saved on `today`: `Arcafold 2026-10-21.zip`. */
export function zipName(today: Date = new Date()): string {
  return `Arcafold ${localDate(today)}.zip`;
}
