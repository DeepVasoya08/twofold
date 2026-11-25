import { errorMessage } from '@arcafold/core/errors';
import type { Settled } from '@arcafold/core/settle-each';

/** What a batch is of: photos, or files (in Files). */
export type Noun = 'photo' | 'file';

/** "1 photo", "1,200 files". */
export const counted = (count: number, noun: Noun = 'photo') =>
  count === 1 ? `1 ${noun}` : `${count.toLocaleString('en-US')} ${noun}s`;

/**
 * What to say after a change to many photos: what was done ("3 photos deleted"), and how
 * many didn't go through; when none did, why.
 */
export function batchText(
  result: Settled<string>,
  done: (photos: string) => string,
  noun: Noun = 'photo',
): string {
  if (result.done.length === 0) return errorMessage(result.error);
  const message = `${done(counted(result.done.length, noun))}.`;
  if (result.failed.length === 0) return message;
  return `${message} ${counted(result.failed.length, noun)} didn’t go through.`;
}

/** The title of a sheet asking before photos are deleted. */
export function deleteTitle(count: number, noun: Noun = 'photo'): string {
  return count === 1 ? `Delete this ${noun}?` : `Delete ${counted(count, noun)}?`;
}

/** The title of a sheet asking before photos in Recently deleted go for good. */
export function deleteForeverTitle(count: number, all: boolean): string {
  if (all) return 'Empty Recently deleted?';
  return count === 1 ? 'Delete this photo for good?' : `Delete ${counted(count)} for good?`;
}

/**
 * What Recently deleted holds, for its link: "3 photos · 1 folder". Items deleted along
 * with a folder count under that folder, not on their own.
 */
export function trashSummary(items: number, folders: number): string {
  const parts = [
    ...(items > 0 ? [counted(items)] : []),
    ...(folders > 0 ? [folders === 1 ? '1 folder' : `${String(folders)} folders`] : []),
  ];
  return parts.join(' · ');
}
