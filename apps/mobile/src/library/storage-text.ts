import { formatBytes } from '@arcafold/core/format-bytes';

/**
 * The storage line on the Settings card: the account's total across both spaces, the same
 * in either one, as on the web, and how full the bar is (0 to 1).
 */
export function storageShown(used: number, limit: number): { label: string; fraction: number } {
  const fraction = limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0;
  return { label: `${formatBytes(used)} of ${formatBytes(limit)}`, fraction };
}
