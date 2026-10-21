/**
 * Looks at every photo that has no face results yet, a few at a time, in the background
 * while the vault is unlocked. Results are shown as they come and saved every so often, so
 * locking or closing the tab loses at most the last few photos' work; the next unlock
 * carries on from there. It waits while `ready` says to (uploads running, tab hidden).
 */
import type { FaceFinder } from './face-finder';
import { FinderStopped } from './face-finder';
import { ModelError } from './models';
import type { FaceResults } from './segment';

/** Previews downloaded per request. */
export const SCAN_BATCH = 12;
/** Results are saved once this many photos are waiting, and when the scan ends. */
export const SAVE_EVERY = 48;
/** After a failed download, wait this long before trying again. */
export const RETRY_MS = 30_000;

export interface ScanDeps {
  /** Photos still to look at, in the order to look at them. */
  pending: () => readonly string[];
  previews: (
    photoIds: readonly string[],
    onPreview: (photoId: string, bytes: Uint8Array<ArrayBuffer> | null) => void,
  ) => Promise<void>;
  finder: FaceFinder;
  /** Shows new results straight away. */
  onResults: (results: FaceResults) => void;
  save: (results: FaceResults) => Promise<void>;
  /** Resolves when scanning may go on. */
  ready: () => Promise<void>;
  wait: (ms: number) => Promise<void>;
  signal: AbortSignal;
}

export type ScanEnd = 'done' | 'stopped' | { error: string };

export async function runScan(deps: ScanDeps): Promise<ScanEnd> {
  // A function, so checks after an await see the abort.
  const stopped = () => deps.signal.aborted;
  let unsaved: FaceResults = new Map();
  /** Photos whose results are waiting to be saved, so they aren't picked again meanwhile. */
  const looked = new Set<string>();

  /** Saves what's waiting. If that fails, it stays waiting for the next try. */
  const flush = async () => {
    if (unsaved.size === 0) return true;
    const batch = unsaved;
    unsaved = new Map();
    try {
      await deps.save(batch);
      return true;
    } catch {
      for (const [id, faces] of batch) if (!unsaved.has(id)) unsaved.set(id, faces);
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
      const previews: { id: string; bytes: Uint8Array<ArrayBuffer> | null }[] = [];
      try {
        await deps.previews(ids, (id, bytes) => previews.push({ id, bytes }));
      } catch {
        if (stopped()) return 'stopped';
        await deps.wait(RETRY_MS);
        continue;
      }
      const found: FaceResults = new Map();
      for (const { id, bytes } of previews) {
        if (stopped()) return 'stopped';
        // A preview that's missing or can't be read has no faces to find.
        const faces = bytes
          ? await deps.finder.find(new Blob([bytes], { type: 'image/jpeg' }))
          : [];
        found.set(id, faces ?? []);
        looked.add(id);
      }
      // A photo the server didn't answer for isn't asked for again until the next unlock.
      for (const id of ids) looked.add(id);
      if (stopped()) return 'stopped';
      deps.onResults(found);
      for (const [id, faces] of found) unsaved.set(id, faces);
      if (unsaved.size >= SAVE_EVERY) await flush();
    }
    if (!(await flush())) {
      return { error: 'Some face results couldn’t be saved. They’ll be found again later.' };
    }
    return 'done';
  } catch (error) {
    if (error instanceof FinderStopped || stopped()) return 'stopped';
    if (error instanceof ModelError) return { error: error.message };
    return { error: 'Finding faces stopped. It will try again next time you unlock.' };
  } finally {
    deps.finder.stop();
  }
}
