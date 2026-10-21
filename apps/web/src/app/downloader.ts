import type { DownloadProgress } from '../lib/download-progress';
import { DOWNLOAD_MAX_BYTES } from '../lib/save-copies';
import type { PreparedCopies } from '../lib/save-copies';
import { errorMessage } from './account-ops';

/**
 * The open space's download, kept outside React so that closing the download dialog (or
 * moving around the app) doesn't stop it or throw away what's been decrypted. Asking again
 * for the same photos picks up where it is instead of decrypting them again. The decrypted
 * copies stay in memory only, until they're saved, the download is cancelled or the vault
 * locks.
 */

export type DownloadStage =
  | { state: 'downloading'; progress: DownloadProgress }
  | { state: 'ready'; prepared: PreparedCopies; note?: string }
  | { state: 'failed'; message: string }
  | { state: 'too-large'; bytes: number }
  | { state: 'empty' };

export interface DownloadJob {
  photoIds: readonly string[];
  stage: DownloadStage;
}

export interface DownloaderState {
  job: DownloadJob | null;
  /** Photos asked for while another download was still going, until that one is decided. */
  waiting: readonly string[] | null;
  /** Whether the download dialog is showing. */
  dialogOpen: boolean;
}

export interface DownloaderDeps {
  /** The photos' stored size, to refuse a download that's too large up front. */
  totalBytes: (photoIds: readonly string[]) => number;
  /** Downloads, decrypts and gets the photos ready to save. */
  prepare: (
    photoIds: readonly string[],
    options: { onProgress: (progress: DownloadProgress) => void; signal: AbortSignal },
  ) => Promise<PreparedCopies>;
}

/** Whether two lists name the same photos, in any order. */
export function samePhotos(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export class Downloader {
  private state: DownloaderState = { job: null, waiting: null, dialogOpen: false };
  private readonly listeners = new Set<() => void>();
  private controller: AbortController | null = null;

  constructor(private deps: DownloaderDeps) {}

  /** Swaps in the latest vault; a download already running keeps its own. */
  connect(deps: DownloaderDeps): void {
    this.deps = deps;
  }

  getState = (): DownloaderState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get running(): boolean {
    return this.state.job?.stage.state === 'downloading';
  }

  /**
   * Opens the dialog for these photos. The same photos as the current download show it as
   * it is (a failed one tries again); different ones start afresh, unless the current one
   * is still going, which the dialog then asks about.
   */
  start = (photoIds: readonly string[]): void => {
    const { job } = this.state;
    if (job && samePhotos(job.photoIds, photoIds)) {
      this.set({ dialogOpen: true, waiting: null });
      if (job.stage.state === 'failed') this.run(photoIds);
      return;
    }
    if (this.running) {
      this.set({ dialogOpen: true, waiting: photoIds });
      return;
    }
    this.set({ dialogOpen: true, waiting: null });
    this.run(photoIds);
  };

  /** Stops the current download and starts the one that was waiting. */
  startWaiting = (): void => {
    const { waiting } = this.state;
    if (!waiting) return;
    this.set({ waiting: null });
    this.run(waiting);
  };

  openDialog = (): void => {
    this.set({ dialogOpen: true });
  };

  /** Hides the dialog. A download still going keeps going, and one ready stays ready. */
  closeDialog = (): void => {
    const stage = this.state.job?.stage.state;
    const keep = stage === 'downloading' || stage === 'ready';
    this.set({ dialogOpen: false, waiting: null, ...(keep ? {} : { job: null }) });
  };

  /** Stops the download, or lets go of copies not saved yet. */
  cancel = (): void => {
    this.controller?.abort();
    this.controller = null;
    this.set({ job: null, waiting: null, dialogOpen: false });
  };

  /** The copies were saved: they're let go. */
  saved = (): void => {
    this.controller = null;
    this.set({ job: null, waiting: null, dialogOpen: false });
  };

  /** Offers the copies another way (a zip, when the share sheet didn't open). */
  replacePrepared = (prepared: PreparedCopies, note: string): void => {
    const { job } = this.state;
    if (job?.stage.state !== 'ready') return;
    this.set({ job: { ...job, stage: { state: 'ready', prepared, note } } });
  };

  /** Stops everything and forgets the copies, as when the vault locks. */
  dispose(): void {
    this.controller?.abort();
    this.controller = null;
    this.state = { job: null, waiting: null, dialogOpen: false };
  }

  private set(change: Partial<DownloaderState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }

  private run(photoIds: readonly string[]): void {
    this.controller?.abort();
    this.controller = null;
    if (photoIds.length === 0) {
      this.set({ job: { photoIds, stage: { state: 'empty' } } });
      return;
    }
    const bytes = this.deps.totalBytes(photoIds);
    if (bytes > DOWNLOAD_MAX_BYTES) {
      this.set({ job: { photoIds, stage: { state: 'too-large', bytes } } });
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    const { signal } = controller;
    const update = (stage: DownloadStage) => {
      if (!signal.aborted) this.set({ job: { photoIds, stage } });
    };
    update({
      state: 'downloading',
      progress: { done: 0, total: photoIds.length, bytesDone: 0, bytesTotal: 0 },
    });
    this.deps
      .prepare(photoIds, {
        signal,
        onProgress: (progress) => {
          update({ state: 'downloading', progress });
        },
      })
      .then(
        (prepared) => {
          update({ state: 'ready', prepared });
        },
        (error: unknown) => {
          update({ state: 'failed', message: errorMessage(error) });
        },
      )
      .finally(() => {
        if (this.controller === controller) this.controller = null;
      });
  }
}
