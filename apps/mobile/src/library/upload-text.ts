import type { UploadItem } from '@arcafold/core/upload/uploader';
import type { UploadSummary } from '@arcafold/core/upload/progress';
import { photoTypeOf } from '@arcafold/core/file-types';

/** What's being added: photos, files, or some of each. */
export type UploadNoun = 'photo' | 'file' | 'item';

/** Photos, files, or items when it's some of each, judged by the names being added. */
export function uploadNoun(items: readonly Pick<UploadItem, 'name'>[]): UploadNoun {
  const photo = items.map((item) => photoTypeOf({ name: item.name, type: '' }) !== null);
  if (photo.every(Boolean)) return 'photo';
  return photo.some(Boolean) ? 'item' : 'file';
}

/** The line on the upload card: how far along it is, or how it went. */
export function uploadHeadline(summary: UploadSummary, noun: UploadNoun = 'photo'): string {
  const photos = (count: number): string =>
    count === 1 ? `1 ${noun}` : `${String(count)} ${noun}s`;
  if (summary.running > 0) {
    return `Adding ${photos(summary.total)}… ${String(summary.done)} done`;
  }
  if (summary.failed === 0) return `${photos(summary.done)} added`;
  if (summary.done === 0) return `${photos(summary.failed)} couldn’t be added`;
  return `${photos(summary.done)} added, ${String(summary.failed)} couldn’t be`;
}

/**
 * The note under the progress while photos are on their way. In the private space they stop
 * if the app locks first, and no notification says when they're in.
 */
export function uploadNote(stopsOnLock: boolean): string {
  return stopsOnLock
    ? 'Keep Arcafold open until they’re in. If it locks first, the ones not sent yet stop, and you’ll need to add them again.'
    : 'You can leave Arcafold: they keep going, and a notification says when they’re in.';
}

/** Why the first one that failed did, when one did. */
export function firstFailure(items: readonly UploadItem[]): string | null {
  const failed = items.find((item) => item.status === 'failed');
  if (!failed) return null;
  return `${failed.name}: ${failed.error ?? 'it couldn’t be added.'}`;
}
