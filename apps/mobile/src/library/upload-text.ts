import type { UploadItem } from '@arcafold/core/upload/uploader';
import type { UploadSummary } from '@arcafold/core/upload/progress';

const photos = (count: number): string => (count === 1 ? '1 photo' : `${String(count)} photos`);

/** The line on the upload card: how far along it is, or how it went. */
export function uploadHeadline(summary: UploadSummary): string {
  if (summary.running > 0) {
    return `Adding ${photos(summary.total)}… ${String(summary.done)} done`;
  }
  if (summary.failed === 0) return `${photos(summary.done)} added`;
  if (summary.done === 0) return `${photos(summary.failed)} couldn’t be added`;
  return `${photos(summary.done)} added, ${String(summary.failed)} couldn’t be`;
}

/** Why the first photo that failed did, when one did. */
export function firstFailure(items: readonly UploadItem[]): string | null {
  const failed = items.find((item) => item.status === 'failed');
  if (!failed) return null;
  return `${failed.name}: ${failed.error ?? 'it couldn’t be added.'}`;
}
