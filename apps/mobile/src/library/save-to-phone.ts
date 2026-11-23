import { STORAGE_SIZES } from '@arcafold/types';

import { copyName } from '@arcafold/core/download/names';
import { DOWNLOADS_AT_ONCE } from '@arcafold/core/download/progress';
import type { DownloadProgress } from '@arcafold/core/download/progress';
import type { Original } from '@arcafold/core/library/space-store';
import { settleEach } from '@arcafold/core/settle-each';
import type { Settled } from '@arcafold/core/settle-each';

/**
 * Saving copies of photos to the phone's gallery. Each original is downloaded and decrypted,
 * a few at once, and goes into the gallery as soon as it's ready, so only those few are ever
 * in memory. It keeps going while you move around the app, and stops (with its copies wiped)
 * when the app locks. A photo that fails doesn't stop the rest.
 */

/** Most bytes saved at once, as on the web: an account's whole quota. */
export const SAVE_MAX_BYTES = STORAGE_SIZES.accountQuota;

/** Where copies go: photos (and videos) to the gallery, other files to Download. */
export const PHOTO_PLACE = 'Pictures/Arcafold';
export const FILE_PLACE = 'Download/Arcafold';

/** Whether a copy of this type goes to the gallery (rather than Download). */
export function isMedia(type: string): boolean {
  return type.startsWith('image/') || type.startsWith('video/');
}

export type SaveJob =
  | { state: 'saving'; progress: DownloadProgress }
  | {
      state: 'done';
      result: Settled<string>;
      /** How many of those saved were photos (to the gallery) and other files. */
      saved: { photos: number; files: number };
    }
  | { state: 'too-large'; bytes: number };

export interface SaverDeps {
  /** A photo's stored size, for the limit and progress (0 when unknown). */
  size: (photoId: string) => number;
  /** Downloads and decrypts a photo's original. */
  original: (photoId: string) => Promise<Original>;
  /** Puts a copy into the gallery; wipes `bytes` once they're handed over. */
  save: (copy: { bytes: Uint8Array; name: string; type: string; takenAt: number }) => Promise<void>;
}

export class Saver {
  private job: SaveJob | null = null;
  private readonly listeners = new Set<() => void>();
  private controller: AbortController | null = null;

  constructor(private deps: SaverDeps) {}

  /** Swaps in the library as it is now. */
  connect(deps: SaverDeps): void {
    this.deps = deps;
  }

  getJob = (): SaveJob | null => this.job;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get running(): boolean {
    return this.job?.state === 'saving';
  }

  /**
   * Starts saving these photos. Returns false (and does nothing) while another save is still
   * going; a finished one is replaced.
   */
  start = (photoIds: readonly string[]): boolean => {
    if (this.running) return false;
    if (photoIds.length === 0) return true;
    const sizes = photoIds.map((id) => this.deps.size(id));
    const bytes = sizes.reduce((sum, size) => sum + size, 0);
    if (bytes > SAVE_MAX_BYTES) {
      this.set({ state: 'too-large', bytes });
      return true;
    }
    const controller = new AbortController();
    this.controller = controller;
    const { signal } = controller;
    const progress: DownloadProgress = {
      done: 0,
      total: photoIds.length,
      bytesDone: 0,
      bytesTotal: bytes,
    };
    this.set({ state: 'saving', progress: { ...progress } });
    const items = photoIds.map((id, index) => ({ id, size: sizes[index] ?? 0 }));
    const saved = { photos: 0, files: 0 };
    void settleEach(items, DOWNLOADS_AT_ONCE, async ({ id, size }) => {
      signal.throwIfAborted();
      try {
        const type = await this.saveOne(id, signal);
        if (isMedia(type)) saved.photos += 1;
        else saved.files += 1;
      } finally {
        progress.done += 1;
        progress.bytesDone += size;
        if (!signal.aborted) this.set({ state: 'saving', progress: { ...progress } });
      }
    }).then((settled) => {
      if (signal.aborted) return;
      this.controller = null;
      const ids = (list: readonly { id: string }[]) => list.map((item) => item.id);
      const result: Settled<string> = { done: ids(settled.done), failed: ids(settled.failed) };
      if (settled.failed.length > 0) result.error = settled.error;
      this.set({ state: 'done', result, saved });
    });
    return true;
  };

  /** Stops saving: photos already in the gallery stay there. */
  cancel = (): void => {
    this.controller?.abort();
    this.controller = null;
    this.set(null);
  };

  /** Lets go of a finished save's outcome. */
  dismiss = (): void => {
    if (!this.running) this.set(null);
  };

  /** Stops everything, as when the app locks. */
  dispose(): void {
    this.controller?.abort();
    this.controller = null;
    this.job = null;
  }

  /** Saves one copy and returns its type. */
  private async saveOne(photoId: string, signal: AbortSignal): Promise<string> {
    const original = await this.deps.original(photoId);
    if (signal.aborted) {
      original.full.fill(0);
      signal.throwIfAborted();
    }
    const taken = Date.parse(original.takenAt);
    await this.deps.save({
      bytes: original.full,
      name: copyName(original),
      type: original.type,
      takenAt: Number.isNaN(taken) ? 0 : taken,
    });
    return original.type;
  }

  private set(job: SaveJob | null): void {
    this.job = job;
    for (const listener of this.listeners) listener();
  }
}
