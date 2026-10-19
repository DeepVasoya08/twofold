/** What happened to each item of a batch: the ones that went through, and the first error. */
export interface Settled<T> {
  done: T[];
  failed: T[];
  /** The first failure's error, to show when nothing went through. */
  error?: unknown;
}

/**
 * Runs `task` on every item, at most `limit` at once, and waits for all of them. A failure
 * doesn't stop the rest. `done` and `failed` keep the items' order.
 */
export async function settleEach<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<Settled<T>> {
  const ok = new Array<boolean>(items.length).fill(false);
  let error: unknown;
  let failures = 0;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        await task(items[index] as T);
        ok[index] = true;
      } catch (caught) {
        if (failures === 0) error = caught;
        failures += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  const settled: Settled<T> = {
    done: items.filter((_, index) => ok[index]),
    failed: items.filter((_, index) => !ok[index]),
  };
  if (failures > 0) settled.error = error;
  return settled;
}
