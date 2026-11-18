import type { Settled } from '@arcafold/core/settle-each';

/** "1 photo", "12 photos", or "Empty". */
export function photoCount(count: number): string {
  if (count === 0) return 'Empty';
  return count === 1 ? '1 photo' : `${count.toLocaleString('en-US')} photos`;
}

/** What to say after putting photos in an album, or taking them out of it. */
export function albumChangeText(
  result: Pick<Settled<string>, 'done' | 'failed'>,
  title: string,
  included: boolean,
): string {
  const done = result.done.length;
  const failed = result.failed.length;
  const photos = done === 1 ? '1 photo' : `${String(done)} photos`;
  const what = included ? `Added ${photos} to “${title}”` : `Removed ${photos} from “${title}”`;
  if (failed === 0) return `${what}.`;
  if (done === 0) {
    return included
      ? 'The photos couldn’t be added. Try again.'
      : 'The photos couldn’t be removed. Try again.';
  }
  return `${what}. ${String(failed)} couldn’t be ${included ? 'added' : 'removed'}; try those again.`;
}

/** "Choose photos", or how many are chosen so far. */
export function chosenText(count: number): string {
  if (count === 0) return 'Choose photos';
  return count === 1 ? '1 chosen' : `${String(count)} chosen`;
}
