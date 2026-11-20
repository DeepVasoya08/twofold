import { errorMessage } from '@arcafold/core/errors';
import type { Settled } from '@arcafold/core/settle-each';

const photos = (count: number) =>
  count === 1 ? '1 photo' : `${count.toLocaleString('en-US')} photos`;

/**
 * What to say after a change to many photos: what was done ("3 photos deleted"), and how
 * many didn't go through; when none did, why.
 */
export function batchText(result: Settled<string>, done: (photos: string) => string): string {
  if (result.done.length === 0) return errorMessage(result.error);
  const message = `${done(photos(result.done.length))}.`;
  if (result.failed.length === 0) return message;
  return `${message} ${photos(result.failed.length)} didn’t go through.`;
}

/** The title of a sheet asking before photos are deleted. */
export function deleteTitle(count: number): string {
  return count === 1 ? 'Delete this photo?' : `Delete ${photos(count)}?`;
}

/** The title of a sheet asking before photos in Recently deleted go for good. */
export function deleteForeverTitle(count: number, all: boolean): string {
  if (all) return 'Empty Recently deleted?';
  return count === 1 ? 'Delete this photo for good?' : `Delete ${photos(count)} for good?`;
}
