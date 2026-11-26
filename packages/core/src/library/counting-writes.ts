import type { SpaceStore } from './space-store';

/** How often an open app in front asks the server whether anything it shows changed. */
export const CHECK_EVERY_MS = 15_000;

/** Coming back to the app checks straight away, unless the last check was this recent. */
export const RECHECK_AFTER_MS = 5_000;

/** Store calls that only read, which never hold back a refresh. */
const READS = new Set<string>([
  'list',
  'image',
  'viewImage',
  'thumbs',
  'previews',
  'listTrash',
  'read',
  'original',
  'fingerprint',
  'fingerprints',
  'stamp',
  'dispose',
]);

/**
 * `store`, counting the changes it has under way (uploads among them), so a refresh never
 * lands on top of a change this device is still making: `busy` says whether there are any,
 * and `started` how many have begun so far (a listing made while it moved may be stale).
 */
export function countingWrites(store: SpaceStore): {
  store: SpaceStore;
  busy: () => boolean;
  started: () => number;
} {
  const writes = { current: 0, started: 0 };
  const counted: Record<string, unknown> = { ...store };
  for (const [name, call] of Object.entries(store)) {
    if (READS.has(name) || typeof call !== 'function') continue;
    const method = call as (...args: unknown[]) => unknown;
    counted[name] = (...args: unknown[]) => {
      writes.current += 1;
      writes.started += 1;
      let result: unknown;
      try {
        result = method(...args);
      } catch (error) {
        writes.current -= 1;
        throw error;
      }
      if (result instanceof Promise) {
        return result.finally(() => {
          writes.current -= 1;
        });
      }
      writes.current -= 1;
      return result;
    };
  }
  return {
    store: counted as unknown as SpaceStore,
    busy: () => writes.current > 0,
    started: () => writes.started,
  };
}
