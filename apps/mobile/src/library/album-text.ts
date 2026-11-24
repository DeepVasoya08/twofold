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

/** What to say after giving photos a heart, or taking it off. */
export function favoriteText(
  result: Pick<Settled<string>, 'done' | 'failed'>,
  favorite: boolean,
): string {
  const done = result.done.length;
  const failed = result.failed.length;
  if (done === 0) {
    return favorite
      ? 'The photos couldn’t be added to favorites. Try again.'
      : 'The photos couldn’t be removed from favorites. Try again.';
  }
  const photos = done === 1 ? '1 photo' : `${String(done)} photos`;
  const what = favorite ? `Added ${photos} to favorites` : `Removed ${photos} from favorites`;
  if (failed === 0) return `${what}.`;
  return `${what}. ${String(failed)} didn’t go through; try those again.`;
}

/** "Choose photos", or how many are chosen so far. */
export function chosenText(count: number): string {
  if (count === 0) return 'Choose photos';
  return count === 1 ? '1 chosen' : `${String(count)} chosen`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The days an album's photos were taken across, shortest first: "Nov 22, 2026",
 * "Nov 20 – 23, 2026", "Oct 30 – Nov 2, 2026" or "Dec 30, 2025 – Jan 2, 2026" (UTC, like the
 * timeline). Null when there are no photos.
 */
export function dateSpan(takenAts: readonly string[]): string | null {
  const times = takenAts.map((at) => Date.parse(at)).filter((time) => !Number.isNaN(time));
  if (times.length === 0) return null;
  const first = new Date(Math.min(...times));
  const last = new Date(Math.max(...times));
  const day = (date: Date) => `${MONTHS[date.getUTCMonth()] ?? ''} ${String(date.getUTCDate())}`;
  const year = (date: Date) => String(date.getUTCFullYear());
  if (first.getUTCFullYear() !== last.getUTCFullYear()) {
    return `${day(first)}, ${year(first)} – ${day(last)}, ${year(last)}`;
  }
  if (first.getUTCMonth() !== last.getUTCMonth()) {
    return `${day(first)} – ${day(last)}, ${year(last)}`;
  }
  if (first.getUTCDate() !== last.getUTCDate()) {
    return `${day(first)} – ${String(last.getUTCDate())}, ${year(last)}`;
  }
  return `${day(first)}, ${year(first)}`;
}
