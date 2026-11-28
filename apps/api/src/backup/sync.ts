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
/**
 * Most files copied in one run, so a big first backup spreads over several runs. Each copy
 * is two R2 calls, and a run may make 10,000 (Workers Paid), which also has to cover listing
 * both buckets and marking.
 */
export const MAX_COPIES_PER_RUN = 3000;
/** No copy starts after this much of a run: a scheduled run may last 15 minutes in all. */
export const COPY_TIME_MS = 10 * 60 * 1000;
/**
 * Copies go straight into Infrequent Access: they're only read during a restore, and every
 * copy lives at least 30 days (the bucket lock), which is that class's minimum. Marks stay
 * in Standard, where writes cost half as much and an empty object costs nothing to keep.
 */
export const COPY_STORAGE_CLASS = 'InfrequentAccess';
/** Each copy holds two connections (read and write); a Worker gets six at once. */
const COPY_CONCURRENCY = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

/** How much one run may copy. */
export interface SyncLimits {
  copies: number;
  copyMs: number;
  /** The time in milliseconds, read before each copy starts. */
  clock: () => number;
}

const LIMITS: SyncLimits = {
  copies: MAX_COPIES_PER_RUN,
  copyMs: COPY_TIME_MS,
  clock: () => Date.now(),
};

export interface SyncResult {
  copied: number;
  /** Files still to copy, left for the next run. */
  pending: number;
  /** How long the oldest file still to copy has waited since it settled; 0 if none has. */
  behindMs: number;
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
    backup.put(`${COPY_PREFIX}${key}`, readable, { storageClass: COPY_STORAGE_CLASS }),
    object.body.pipeTo(writable),
  ]);
  return stored.size === object.size;
}

/**
 * Runs `task` over `items`, `limit` at a time, starting no more once `more` says no; returns
 * how many were started and how many of those succeeded.
 */
async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<boolean>,
  more: () => boolean = () => true,
): Promise<{ started: number; succeeded: number }> {
  let next = 0;
  let succeeded = 0;
  const worker = async () => {
    while (next < items.length && more()) {
      const item = items[next++] as T;
      try {
        if (await task(item)) succeeded++;
      } catch {
        // Counted as failed by the caller; the next run tries again.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return { started: next, succeeded };
}

export async function syncBackup(
  source: R2Bucket,
  backup: R2Bucket,
  now: Date,
  limits: Partial<SyncLimits> = {},
): Promise<SyncResult> {
  const { copies: maxCopies, copyMs, clock } = { ...LIMITS, ...limits };
  const startedAt = clock();
  const [files, copies, gone] = await Promise.all([
    listAll(source),
    listAll(backup, COPY_PREFIX),
    listAll(backup, GONE_PREFIX),
  ]);

  // Files to copy: missing or a different size, once they've settled. Oldest first, since
  // names are photo ids, which uploads choose: by name, files called to sort first could keep
  // older photos waiting for as long as more of them kept coming.
  const settledBefore = now.getTime() - SETTLE_MS;
  const toCopy = [...files.values()]
    .filter((file) => file.uploaded.getTime() <= settledBefore)
    .filter((file) => copies.get(file.key)?.size !== file.size)
    .sort(
      (a, b) =>
        a.uploaded.getTime() - b.uploaded.getTime() || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
  const batch = toCopy.slice(0, maxCopies);
  const { started, succeeded: copied } = await eachLimited(
    batch,
    COPY_CONCURRENCY,
    (file) => copy(source, backup, file.key),
    () => clock() - startedAt < copyMs,
  );
  const oldestWaiting = toCopy[started];
  const behindMs = oldestWaiting ? settledBefore - oldestWaiting.uploaded.getTime() : 0;

  // A file that came back (or was never really gone) loses its mark.
  const unmark = [...gone.keys()].filter((key) => files.has(key));
  if (unmark.length > 0) await backup.delete(unmark.map((key) => `${GONE_PREFIX}${key}`));

  // An empty photo bucket next to existing copies is far more likely a wrong binding or a
  // failed listing than every photo deleted at once, so nothing is marked.
  const guarded = files.size === 0 && copies.size > 0;
  const toMark = guarded
    ? []
    : [...copies.keys()].filter((key) => !files.has(key) && !gone.has(key));
  const { succeeded: marked } = await eachLimited(toMark, COPY_CONCURRENCY, async (key) => {
    await backup.put(`${GONE_PREFIX}${key}`, new Uint8Array(0));
    return true;
  });

  // Copies whose file has been gone for KEEP_DELETED_DAYS are removed, then their mark.
  const expiredBefore = now.getTime() - KEEP_DELETED_DAYS * DAY_MS;
  const toRemove = [...gone.values()]
    .filter((mark) => !files.has(mark.key) && mark.uploaded.getTime() <= expiredBefore)
    .map((mark) => mark.key);
  const { succeeded: removed } = await eachLimited(toRemove, COPY_CONCURRENCY, async (key) => {
    await backup.delete(`${COPY_PREFIX}${key}`);
    await backup.delete(`${GONE_PREFIX}${key}`);
    return true;
  });

  return {
    copied,
    pending: toCopy.length - started,
    behindMs,
    marked,
    unmarked: unmark.length,
    removed,
    failed: started - copied + (toMark.length - marked) + (toRemove.length - removed),
    guarded,
  };
}
