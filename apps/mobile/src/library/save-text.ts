import type { DownloadProgress } from '@arcafold/core/download/progress';

import { FILE_PLACE, PHOTO_PLACE } from './save-to-phone';
import type { SaveJob } from './save-to-phone';
import { batchText } from './trash-text';

const megabytes = (bytes: number) =>
  `${Math.ceil(bytes / (1024 * 1024)).toLocaleString('en-US')} MB`;

/** What the card says while photos are saving. */
export function savingText(progress: DownloadProgress): string {
  if (progress.total === 1) return 'Saving to your phone…';
  return `Saving ${String(Math.min(progress.done + 1, progress.total))} of ${progress.total.toLocaleString('en-US')} to your phone…`;
}

/** What to say once a save has ended, or why it didn't start. Null while it's going. */
export function saveOutcome(job: SaveJob): string | null {
  if (job.state === 'saving') return null;
  if (job.state === 'too-large') {
    return `That’s ${megabytes(job.bytes)}. Save up to 1 GB at a time: pick fewer photos.`;
  }
  const { photos, files } = job.saved;
  if (files === 0) return batchText(job.result, (done) => `${done} saved to ${PHOTO_PLACE}`);
  if (photos === 0) {
    return batchText(job.result, (done) => `${done} saved to ${FILE_PLACE}`, 'file');
  }
  return batchText(
    job.result,
    (done) => `${done} saved to ${PHOTO_PLACE} and ${FILE_PLACE}`,
    'file',
  );
}
