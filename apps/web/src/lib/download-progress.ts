import { settleEach } from './settle-each';

/**
 * Downloading many photos at once, a few at a time, and how far along it is. The network is
 * what takes the time (decrypting runs at 75–160 MB/s), so several requests run together.
 */

/** How many photos download at once. */
export const DOWNLOADS_AT_ONCE = 4;

/** How far a download is: photos and (roughly, from their stored sizes) bytes. */
export interface DownloadProgress {
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
}

/** A photo to download, with its stored size (0 when unknown). */
export interface DownloadItem {
  id: string;
  size: number;
}

/** How much of the work is done, from 0 to 100, by bytes when sizes are known. */
export function progressPercent(progress: DownloadProgress): number {
  const fraction =
    progress.bytesTotal > 0
      ? progress.bytesDone / progress.bytesTotal
      : progress.total > 0
        ? progress.done / progress.total
        : 0;
  return Math.round(Math.min(1, Math.max(0, fraction)) * 100);
}

/**
 * Runs `fetchOne` for every item, `limit` at a time, and resolves to the results in the
 * items' order. Reports progress after each photo. Stops starting new ones once one fails
 * or `signal` aborts, and then rejects with that error.
 */
export async function downloadAll<T>(
  items: readonly DownloadItem[],
  fetchOne: (id: string) => Promise<T>,
  {
    limit = DOWNLOADS_AT_ONCE,
    onProgress,
    signal,
  }: {
    limit?: number;
    onProgress?: (progress: DownloadProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<T[]> {
  const progress: DownloadProgress = {
    done: 0,
    total: items.length,
    bytesDone: 0,
    bytesTotal: items.reduce((sum, item) => sum + item.size, 0),
  };
  onProgress?.({ ...progress });
  const results = new Array<{ value: T }>(items.length);
  let stopped = false;
  const indexed = items.map((item, index) => ({ item, index }));
  const settled = await settleEach(indexed, limit, async ({ item, index }) => {
    if (stopped) throw new Error('Stopped');
    signal?.throwIfAborted();
    try {
      results[index] = { value: await fetchOne(item.id) };
      signal?.throwIfAborted();
    } catch (error) {
      stopped = true;
      throw error;
    }
    progress.done += 1;
    progress.bytesDone += item.size;
    onProgress?.({ ...progress });
  });
  if (settled.failed.length > 0) throw settled.error;
  return results.map((result) => result.value);
}
