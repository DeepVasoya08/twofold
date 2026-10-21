import { STORAGE_SIZES } from '@twofold/types';

import type { Photo } from '../mock/data';

/**
 * What the open space takes up: the encrypted size of its own photos, as listed. Photos in
 * libraries shared with you are someone else's space, so they're left out.
 *
 * The 1 GB limit is per account. The main library shows only its own photos ("used here"):
 * the account's total would include the private space, so showing it there would hint that
 * one exists. The private space shows the account's total instead (app/storage.tsx), which
 * only it asks the server for.
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

/** Whether a figure is the open space's own photos, or the account's total. */
export type UsageScope = 'here' | 'total';

/**
 * What the storage meter shows. The main library: its own photos. The private space: the
 * account's total once the server has said (never less than the space's own photos, which
 * it includes), and its own photos until then.
 */
export function shownUsage(
  space: 'main' | 'private',
  own: number,
  total: number | null,
): { bytes: number; scope: UsageScope } {
  if (space === 'main') return { bytes: own, scope: 'here' };
  return { bytes: Math.max(total ?? 0, own), scope: 'total' };
}

/** "12.4 MB of 1 GB used here" for the open space, or "… used in total" for the account. */
export function usageLabel(bytes: number, scope: UsageScope): string {
  const of = `${formatBytes(bytes)} of ${formatBytes(STORAGE_SIZES.accountQuota)}`;
  return scope === 'here' ? `${of} used here` : `${of} used in total`;
}
