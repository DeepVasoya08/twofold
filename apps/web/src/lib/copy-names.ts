import { extensionOf } from './photo-types';

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

/**
 * Names a batch of photos by when they were taken, with the extension of their type. Photos
 * taken in the same second get ` (2)`, ` (3)` and so on, so every name is different.
 */
export function copyNames(photos: readonly { takenAt: string; type: string }[]): string[] {
  const used = new Set<string>();
  return photos.map(({ takenAt, type }) => {
    const base = takenName(takenAt);
    const extension = extensionOf(type);
    let name = `${base}.${extension}`;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) {
      name = `${base} (${String(n)}).${extension}`;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

/** The name of a zip of photos saved on `today`: `Twofold 2026-10-21.zip`. */
export function zipName(today: Date = new Date()): string {
  return `Twofold ${localDate(today)}.zip`;
}
