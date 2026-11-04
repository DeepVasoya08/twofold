import { fileExtension } from '@arcafold/core/file-types';
import { extensionOf } from '@arcafold/core/photo-types';

/**
 * Names for photos saved to the device: when each was taken, in this browser's time zone,
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

/** A file's own name split into its base and extension (without the dot). */
function splitName(name: string): { base: string; extension: string } {
  const length = fileExtension(name).length;
  if (length === 0) return { base: name, extension: '' };
  return { base: name.slice(0, name.length - length - 1), extension: name.slice(-length) };
}

/**
 * Names a batch of photos by when they were taken, with the extension of their type; a file
 * (not a photo) keeps its own `name`. Names that would clash get ` (2)`, ` (3)` and so on,
 * so every name is different.
 */
export function copyNames(
  photos: readonly { takenAt: string; type: string; name?: string }[],
): string[] {
  const used = new Set<string>();
  return photos.map(({ takenAt, type, name: own }) => {
    const { base, extension } =
      own === undefined
        ? { base: takenName(takenAt), extension: extensionOf(type) }
        : splitName(own);
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
