import { THUMB_BATCH_MAX } from '@twofold/types';

/**
 * Thumbnails download only once their photo is near the screen, many per request. Requests
 * made within this long of each other share a batch, and at most THUMB_REQUESTS batches are
 * downloading at once.
 */
export const THUMB_GATHER_MS = 30;
export const THUMB_REQUESTS = 2;
/**
 * Decrypted thumbnails reach the screen together, at most this often. One update per
 * thumbnail would redraw the whole grid once per photo, which a large library can't afford.
 */
export const THUMB_FLUSH_MS = 100;
/**
 * A batch that fails is tried again after this long, doubling each time, up to THUMB_RETRIES
 * times. A photo is only asked for once when it comes near the screen, so without retries
 * one failed request would leave its tiles empty until the grid is opened again.
 */
export const THUMB_RETRY_MS = 1000;
export const THUMB_RETRIES = 3;

/**
 * Thrown by a fetch that got some previews but failed for others (one of several libraries
 * couldn't be reached). The ones it got are shown; only the failed ones are tried again.
 */
export class PartialThumbs extends Error {
  constructor(
    readonly found: ReadonlyMap<string, string>,
    readonly failed: readonly string[],
  ) {
    super('Some previews could not be downloaded.');
  }
}

export interface ThumbLoaderDeps {
  /** Downloads and decrypts previews, as blob URLs by photo id. */
  fetch: (photoIds: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  /** Previews ready to show, a few at a time. */
  onReady: (urls: ReadonlyMap<string, string>) => void;
}

export interface ThumbLoader {
  /** Asks for photos' previews. Asking twice is free. */
  request: (photoIds: readonly string[]) => void;
  /** Stops everything; nothing more reaches `onReady`. */
  stop: () => void;
}

export function createThumbLoader({ fetch, onReady }: ThumbLoaderDeps): ThumbLoader {
  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (run: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
    return timer;
  };

  let ready = new Map<string, string>();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    flushTimer = undefined;
    if (stopped || ready.size === 0) return;
    onReady(ready);
    ready = new Map();
  };

  // Each photo's preview is asked for once; `wanted` holds those not yet downloading.
  const asked = new Set<string>();
  const wanted = new Set<string>();
  /** Failed tries so far, for photos whose batch failed. */
  const failures = new Map<string, number>();
  let downloading = 0;
  let gatherTimer: ReturnType<typeof setTimeout> | undefined;

  const want = (photoIds: Iterable<string>) => {
    for (const photoId of photoIds) wanted.add(photoId);
    if (wanted.size > 0) gatherTimer ??= later(pump, THUMB_GATHER_MS);
  };

  const failed = (batch: readonly string[]) => {
    const retry: string[] = [];
    let tries = 0;
    for (const photoId of batch) {
      const count = (failures.get(photoId) ?? 0) + 1;
      if (count > THUMB_RETRIES) {
        // Given up for now: it can be asked for again when its tile is shown again.
        failures.delete(photoId);
        asked.delete(photoId);
        continue;
      }
      failures.set(photoId, count);
      retry.push(photoId);
      tries = Math.max(tries, count);
    }
    if (retry.length > 0) {
      later(
        () => {
          if (!stopped) want(retry);
        },
        THUMB_RETRY_MS * 2 ** (tries - 1),
      );
    }
  };

  function pump() {
    gatherTimer = undefined;
    while (!stopped && downloading < THUMB_REQUESTS && wanted.size > 0) {
      const batch = [...wanted].slice(0, THUMB_BATCH_MAX);
      for (const photoId of batch) wanted.delete(photoId);
      downloading += 1;
      const show = (urls: ReadonlyMap<string, string>, retry: readonly string[]) => {
        if (stopped) return;
        for (const photoId of batch) if (!retry.includes(photoId)) failures.delete(photoId);
        for (const [photoId, url] of urls) ready.set(photoId, url);
        if (urls.size > 0) flushTimer ??= later(flush, THUMB_FLUSH_MS);
        if (retry.length > 0) failed(retry);
      };
      fetch(batch)
        .then(
          (urls) => {
            show(urls, []);
          },
          (error: unknown) => {
            if (error instanceof PartialThumbs) show(error.found, error.failed);
            else show(new Map(), batch);
          },
        )
        .finally(() => {
          downloading -= 1;
          pump();
        });
    }
  }

  return {
    request: (photoIds) => {
      const fresh = photoIds.filter((photoId) => !asked.has(photoId));
      for (const photoId of fresh) asked.add(photoId);
      want(fresh);
    },
    stop: () => {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
