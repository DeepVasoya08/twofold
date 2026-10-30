/**
 * Keeps a copy of every photo file in the backup bucket (docs/backups.md).
 *
 * Each run compares the two buckets. It copies files that aren't backed up yet, and marks
 * copies whose file is gone from the photo bucket. A copy is removed 30 days after its
 * mark, so a photo deleted by mistake (or by an attacker) can still be restored for 30
 * days. The files are already encrypted on the device; this only moves ciphertext.
 */

/** Copies live under r2/, named after the file they copy. */
export const COPY_PREFIX = 'r2/';
/** gone/<key> says when a file was first seen missing (its upload time). */
export const GONE_PREFIX = 'gone/';
/** How long a copy outlives its file. Matches the backup bucket's lock on r2/. */
export const KEEP_DELETED_DAYS = 30;
/** Files younger than this may still be re-uploaded (a retried upload), so they wait. */
export const SETTLE_MS = 60 * 60 * 1000;
/** Per run, so a big first backup spreads over several runs. */
export const MAX_COPIES_PER_RUN = 500;
/** Each copy holds two connections (read and write); a Worker gets six at once. */
const COPY_CONCURRENCY = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SyncResult {
  copied: number;
  /** Files still to copy, left for the next run. */
  pending: number;
  marked: number;
  unmarked: number;
  removed: number;
  /** Copies or removals that failed; retried next run. */
  failed: number;
  /** True when the photo bucket looked empty and nothing was marked. */
  guarded: boolean;
}

interface Listed {
  key: string;
  size: number;
  uploaded: Date;
}

async function listAll(bucket: R2Bucket, prefix?: string): Promise<Map<string, Listed>> {
  const found = new Map<string, Listed>();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      limit: 1000,
      ...(prefix ? { prefix } : {}),
      ...(cursor ? { cursor } : {}),
    });
    for (const object of page.objects) {
      const key = prefix ? object.key.slice(prefix.length) : object.key;
      found.set(key, { key, size: object.size, uploaded: object.uploaded });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return found;
}

async function copy(source: R2Bucket, backup: R2Bucket, key: string): Promise<boolean> {
  const object = await source.get(key);
  if (!object) return false; // Deleted since the listing.
  // A fixed-length stream lets R2 take the body without holding it all in memory.
  const { readable, writable } = new FixedLengthStream(object.size);
  const [stored] = await Promise.all([
    backup.put(`${COPY_PREFIX}${key}`, readable),
    object.body.pipeTo(writable),
  ]);
  return stored?.size === object.size;
}

/** Runs `task` over `items`, `limit` at a time; returns how many succeeded. */
async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<boolean>,
): Promise<number> {
  let next = 0;
  let succeeded = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      try {
        if (await task(item)) succeeded++;
      } catch {
        // Counted as failed by the caller; the next run tries again.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return succeeded;
}

export async function syncBackup(
  source: R2Bucket,
  backup: R2Bucket,
  now: Date,
): Promise<SyncResult> {
  const [files, copies, gone] = await Promise.all([
    listAll(source),
    listAll(backup, COPY_PREFIX),
    listAll(backup, GONE_PREFIX),
  ]);

  // Files to copy: missing or a different size, once they've settled.
  const settledBefore = now.getTime() - SETTLE_MS;
  const toCopy = [...files.values()]
    .filter((file) => file.uploaded.getTime() <= settledBefore)
    .filter((file) => copies.get(file.key)?.size !== file.size)
    .map((file) => file.key);
  const batch = toCopy.slice(0, MAX_COPIES_PER_RUN);
  const copied = await eachLimited(batch, COPY_CONCURRENCY, (key) => copy(source, backup, key));

  // A file that came back (or was never really gone) loses its mark.
  const unmark = [...gone.keys()].filter((key) => files.has(key));
  if (unmark.length > 0) await backup.delete(unmark.map((key) => `${GONE_PREFIX}${key}`));

  // An empty photo bucket next to existing copies is far more likely a wrong binding or a
  // failed listing than every photo deleted at once, so nothing is marked.
  const guarded = files.size === 0 && copies.size > 0;
  const toMark = guarded
    ? []
    : [...copies.keys()].filter((key) => !files.has(key) && !gone.has(key));
  const marked = await eachLimited(toMark, COPY_CONCURRENCY, async (key) => {
    await backup.put(`${GONE_PREFIX}${key}`, new Uint8Array(0));
    return true;
  });

  // Copies whose file has been gone for KEEP_DELETED_DAYS are removed, then their mark.
  const expiredBefore = now.getTime() - KEEP_DELETED_DAYS * DAY_MS;
  const toRemove = [...gone.values()]
    .filter((mark) => !files.has(mark.key) && mark.uploaded.getTime() <= expiredBefore)
    .map((mark) => mark.key);
  const removed = await eachLimited(toRemove, COPY_CONCURRENCY, async (key) => {
    await backup.delete(`${COPY_PREFIX}${key}`);
    await backup.delete(`${GONE_PREFIX}${key}`);
    return true;
  });

  return {
    copied,
    pending: toCopy.length - batch.length,
    marked,
    unmarked: unmark.length,
    removed,
    failed: batch.length - copied + (toMark.length - marked) + (toRemove.length - removed),
    guarded,
  };
}
