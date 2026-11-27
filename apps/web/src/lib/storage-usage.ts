import { STORAGE_SIZES } from '@arcafold/types';
import { formatBytes } from '@arcafold/core/format-bytes';
import type { Photo } from '@arcafold/core/library/model';

export { formatBytes };

/**
 * What the open space takes up: the encrypted size of its own photos, as listed. Photos in
 * libraries shared with you are someone else's space, so they're left out.
 *
 * The limit is per account (its plan's), and both spaces show the account's total (app/storage.tsx);
 * this is the figure shown until the server has answered.
 */
export function spaceBytes(photos: readonly Photo[]): number {
  return photos.reduce(
    (total, photo) => (photo.library === undefined ? total + (photo.size ?? 0) : total),
    0,
  );
}

/** The limit shown until the server has said: the Free plan's. */
export const DEFAULT_LIMIT = STORAGE_SIZES.accountQuota;

/** How much of the account's `limit` `bytes` is, from 0 to 1. */
export function usedFraction(bytes: number, limit: number): number {
  return limit > 0 ? Math.min(1, Math.max(0, bytes / limit)) : 1;
}

/**
 * What the storage meter shows, in either space: the account's total once the server has
 * said (never less than the open space's own photos, which it includes), and the open
 * space's own photos until then.
 */
export function shownUsage(own: number, total: number | null): number {
  return Math.max(total ?? 0, own);
}

/** "12.4 MB of 50 GB used", for the whole account. */
export function usageLabel(bytes: number, limit: number): string {
  return `${formatBytes(bytes)} of ${formatBytes(limit)} used`;
}
