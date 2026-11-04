/**
 * Pieces of the backup test that don't touch the phone, so they can be tested in Node.
 */

/**
 * Runs `work` on every item, at most `limit` at a time, in order of starting. Uses only
 * promises, never timers: React Native pauses timers while the app is in the background.
 */
export async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      await work(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/** One stretch of time the app spent in a state (active, background, inactive). */
export interface StateSpan {
  state: string;
  from: number;
  to: number;
}

/** How many photos finished while the app was not on screen. */
export function finishedInBackground(finishedAt: readonly number[], spans: readonly StateSpan[]) {
  return finishedAt.filter((t) =>
    spans.some((s) => s.state !== 'active' && t >= s.from && t < s.to),
  ).length;
}

/** The longest wait between one photo finishing and the next (or the start), in ms. */
export function longestGap(start: number, finishedAt: readonly number[]): number {
  let last = start;
  let gap = 0;
  for (const t of [...finishedAt].sort((a, b) => a - b)) {
    gap = Math.max(gap, t - last);
    last = t;
  }
  return gap;
}
