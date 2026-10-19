import { STORAGE_SIZES } from '@twofold/types';

import type { Photo } from '../mock/data';

/**
 * What the open space takes up: the encrypted size of its own photos, as listed. Photos in
 * libraries shared with you are someone else's space, so they're left out.
 *
 * The 1 GB limit is per account, but each space shows only its own photos. The account's
 * total would include the other space, so showing it in the main library would hint at a
 * private space; the server's total is never asked for.
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

/** "12.4 MB of 1 GB used" for the open space. */
export function usageLabel(bytes: number): string {
  return `${formatBytes(bytes)} of ${formatBytes(STORAGE_SIZES.accountQuota)} used`;
}
