import { STORAGE_SIZES } from '@twofold/types';

import type { Photo } from '../mock/data';

/**
 * What the open space takes up: the encrypted size of its own photos, as listed. Photos in
 * libraries shared with you are someone else's space, so they're left out.
 *
 * The 1 GB limit is per account, and both spaces show the account's total (app/storage.tsx);
 * this is the figure shown until the server has answered.
 */
export function spaceBytes(photos: readonly Photo[]): number {
  return photos.reduce(
    (total, photo) => (photo.library === undefined ? total + (photo.size ?? 0) : total),
    0,
  );
}

/** How much of the account's limit `bytes` is, from 0 to 1. */
export function usedFraction(bytes: number): number {
  return Math.min(1, Math.max(0, bytes / STORAGE_SIZES.accountQuota));
}

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** "0 B", "740 KB", "12.4 MB", "1 GB": binary units, as the limit is counted. */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value < 100 && unit > 0 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded.toLocaleString('en-US')} ${UNITS[unit] ?? 'GB'}`;
}

/**
 * What the storage meter shows, in either space: the account's total once the server has
 * said (never less than the open space's own photos, which it includes), and the open
 * space's own photos until then.
 */
export function shownUsage(own: number, total: number | null): number {
  return Math.max(total ?? 0, own);
}

/** "12.4 MB of 1 GB used", for the whole account. */
export function usageLabel(bytes: number): string {
  return `${formatBytes(bytes)} of ${formatBytes(STORAGE_SIZES.accountQuota)} used`;
}
