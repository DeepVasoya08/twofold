/**
 * Looks at every photo that has no result yet, a few at a time, in the background while the
 * vault is unlocked: face grouping and Smart search both use it. Results are shown as they
 * come and saved every so often, so locking or closing the tab loses at most the last few
 * photos' work; the next unlock carries on from there. It waits while `ready` says to
 * (uploads running, tab hidden).
 */

/** Previews downloaded per request. */
export const SCAN_BATCH = 12;
/** Results are saved once this many photos are waiting, and when the scan ends. */
export const SAVE_EVERY = 48;
/** After a failed download, wait this long before trying again. */
export const RETRY_MS = 30_000;

/** Works out one photo's result from its preview. Null means the image couldn't be read. */
export interface Looker<T> {
  look: (image: Blob) => Promise<T | null>;
  stop: () => void;
}

export interface BackgroundScanDeps<T> {
  /** Photos still to look at, in the order to look at them. */
  pending: () => readonly string[];
  previews: (
    photoIds: readonly string[],
    onPreview: (photoId: string, bytes: Uint8Array<ArrayBuffer> | null) => void,
  ) => Promise<void>;
  looker: Looker<T>;
  /** The result for a photo whose preview is missing or can't be read. */
  empty: T;
  /**
   * Runs once, before the first previews are downloaded (loading the model, say), so a
   * model that can't load doesn't cost a batch of downloads. Errors end the scan.
   */
  prepare?: () => Promise<void>;
  /** Shows new results straight away. */
  onResults: (results: Map<string, T>) => void;
  save: (results: Map<string, T>) => Promise<void>;
  /** Resolves when scanning may go on. */
  ready: () => Promise<void>;
  wait: (ms: number) => Promise<void>;
  signal: AbortSignal;
  /** What to say when an error ends the scan: null means it was stopped, not a failure. */
  explain: (error: unknown) => string | null;
  /** What to say when the last results couldn't be saved. */
  saveFailed: string;
}

export type ScanEnd = 'done' | 'stopped' | { error: string };

export async function runBackgroundScan<T>(deps: BackgroundScanDeps<T>): Promise<ScanEnd> {
  // A function, so checks after an await see the abort.
  const stopped = () => deps.signal.aborted;
  let unsaved = new Map<string, T>();
  /** Photos whose results are waiting to be saved, so they aren't picked again meanwhile. */
  const looked = new Set<string>();
  let prepared = false;

  /** Saves what's waiting. If that fails, it stays waiting for the next try. */
  const flush = async () => {
    if (unsaved.size === 0) return true;
    const batch = unsaved;
    unsaved = new Map();
    try {
      await deps.save(batch);
      return true;
    } catch {
      for (const [id, result] of batch) if (!unsaved.has(id)) unsaved.set(id, result);
      return false;
    }
  };

  try {
    for (;;) {
      await deps.ready();
      if (stopped()) return 'stopped';
      const ids = deps
        .pending()
        .filter((id) => !looked.has(id))
        .slice(0, SCAN_BATCH);
      if (ids.length === 0) break;
      if (!prepared) {
        await deps.prepare?.();
        prepared = true;
        if (stopped()) return 'stopped';
      }
      const previews: { id: string; bytes: Uint8Array<ArrayBuffer> | null }[] = [];
      try {
        await deps.previews(ids, (id, bytes) => previews.push({ id, bytes }));
      } catch {
        if (stopped()) return 'stopped';
        await deps.wait(RETRY_MS);
        continue;
      }
      const found = new Map<string, T>();
      for (const { id, bytes } of previews) {
        if (stopped()) return 'stopped';
        const result = bytes
          ? await deps.looker.look(new Blob([bytes], { type: 'image/jpeg' }))
          : null;
        found.set(id, result ?? deps.empty);
        looked.add(id);
      }
      // A photo the server didn't answer for isn't asked for again until the next unlock.
      for (const id of ids) looked.add(id);
      if (stopped()) return 'stopped';
      deps.onResults(found);
      for (const [id, result] of found) unsaved.set(id, result);
      if (unsaved.size >= SAVE_EVERY) await flush();
    }
    if (!(await flush())) return { error: deps.saveFailed };
    return 'done';
  } catch (error) {
    if (stopped()) return 'stopped';
    const message = deps.explain(error);
    return message === null ? 'stopped' : { error: message };
  } finally {
    deps.looker.stop();
  }
}
