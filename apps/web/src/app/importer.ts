import type { ImportItem } from '../lib/import/takeout';
import { canStartUpload } from '@arcafold/core/upload/queue';
import type { InFlight } from '@arcafold/core/upload/queue';
import type { Album, Photo } from '@arcafold/core/library/model';
import { errorMessage } from '@arcafold/core/errors';
import type { NewPhoto } from '@arcafold/core/library/space-store';

/**
 * Runs an import into the open space, kept outside React like the upload queue, so moving
 * around the app doesn't stop it. Each photo is read from the export, fingerprinted and
 * skipped if the space already has it (see photoFingerprint), otherwise prepared, encrypted
 * and uploaded, a few at a time. New photos are shown in batches, so the library changes
 * every few dozen photos rather than after each one.
 */

export interface ImportJob {
  item: ImportItem;
  /** The albums it goes in, already made. */
  albums: Album[];
}

export interface ImportFailure {
  name: string;
  error: string;
}

export interface ImporterState {
  phase: 'idle' | 'running' | 'done';
  total: number;
  /** Photos stored so far. */
  imported: number;
  /** Photos skipped because the space already had them. */
  already: number;
  failures: readonly ImportFailure[];
  /** Whether it was stopped before the end. */
  stopped: boolean;
}

export interface ImporterDeps {
  /** The photo's fingerprint in the open space. */
  fingerprint: (original: Uint8Array) => Promise<string>;
  /** Fingerprints of the photos the space has, with their ids. */
  known: () => ReadonlyMap<string, string>;
  /** Makes what the vault stores from a photo's bytes: a preview, and its date. */
  prepare: (item: ImportItem, original: Uint8Array<ArrayBuffer>) => Promise<NewPhoto>;
  /** Encrypts and stores a photo, without showing it yet. */
  upload: (photo: NewPhoto, albumIds: string[]) => Promise<Photo>;
  /** Puts a photo the space already had into albums. */
  addToAlbums: (photoId: string, albums: Album[]) => Promise<void>;
  /** Shows photos stored since the last time. */
  onStored: (photos: Photo[]) => void;
}

/** New photos are shown after this many, and at the end. */
export const SHOW_EVERY = 24;

const IDLE: ImporterState = {
  phase: 'idle',
  total: 0,
  imported: 0,
  already: 0,
  failures: [],
  stopped: false,
};

export class Importer {
  private state: ImporterState = IDLE;
  private readonly listeners = new Set<() => void>();
  private queue: ImportJob[] = [];
  private inFlight: InFlight = { count: 0, bytes: 0 };
  private stored: Photo[] = [];
  /** Fingerprints seen in this run: the photo's id once stored, '' while it's on its way. */
  private seen = new Map<string, string>();
  /** Bumped by dispose, so work from before it is dropped. */
  private run = 0;
  /** Called once when the running import ends (not when it's dropped). */
  private onDone: (() => void) | undefined;

  constructor(private deps: ImporterDeps) {}

  /** Swaps in the latest vault; photos already on their way keep their own. */
  connect(deps: ImporterDeps): void {
    this.deps = deps;
  }

  getState = (): ImporterState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get running(): boolean {
    return this.state.phase === 'running';
  }

  /** Starts importing; `onDone` is called when it ends. Does nothing while one runs. */
  start = (jobs: readonly ImportJob[], onDone?: () => void): void => {
    if (this.running) return;
    this.onDone = onDone;
    this.queue = [...jobs];
    this.seen = new Map();
    this.set({ ...IDLE, phase: 'running', total: jobs.length });
    this.pump();
  };

  /** Stops taking new photos; those on their way finish. */
  stop = (): void => {
    if (!this.running) return;
    this.queue = [];
    this.set({ stopped: true });
    this.settle();
  };

  /** Back to the start, once an import has finished. */
  reset = (): void => {
    if (this.running) return;
    this.set(IDLE);
  };

  /** Drops everything, as when the vault locks. */
  dispose(): void {
    this.run += 1;
    this.queue = [];
    this.stored = [];
    this.inFlight = { count: 0, bytes: 0 };
    this.onDone = undefined;
    this.set(IDLE);
  }

  private set(change: Partial<ImporterState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }

  private async importOne({ item, albums }: ImportJob, run: number): Promise<void> {
    const { fingerprint, known, prepare, upload, addToAlbums } = this.deps;
    try {
      const original = await item.source.read();
      const fp = await fingerprint(original);
      const existing = known().get(fp) ?? this.seen.get(fp);
      if (existing !== undefined) {
        if (existing !== '' && albums.length > 0) {
          await addToAlbums(existing, albums).catch(() => undefined);
        }
        if (run === this.run) this.set({ already: this.state.already + 1 });
        return;
      }
      this.seen.set(fp, '');
      const photo = await prepare(item, original);
      const stored = await upload(
        photo,
        albums.map((album) => album.id),
      );
      if (run !== this.run) return;
      this.seen.set(fp, stored.id);
      this.stored.push(stored);
      this.set({ imported: this.state.imported + 1 });
      if (this.stored.length >= SHOW_EVERY) this.show();
    } catch (error) {
      if (run !== this.run) return;
      this.set({
        failures: [...this.state.failures, { name: item.name, error: errorMessage(error) }],
      });
    }
  }

  private show(): void {
    if (this.stored.length === 0) return;
    const stored = this.stored;
    this.stored = [];
    this.deps.onStored(stored);
  }

  /** Starts queued photos while there's room, in order. */
  private pump(): void {
    const run = this.run;
    for (let job = this.queue[0]; job; job = this.queue[0]) {
      const size = job.item.size;
      if (!canStartUpload(this.inFlight, size)) break;
      this.queue.shift();
      this.inFlight = { count: this.inFlight.count + 1, bytes: this.inFlight.bytes + size };
      void this.importOne(job, run).finally(() => {
        if (run !== this.run) return;
        this.inFlight = { count: this.inFlight.count - 1, bytes: this.inFlight.bytes - size };
        this.pump();
      });
    }
    this.settle();
  }

  private settle(): void {
    if (!this.running || this.inFlight.count > 0 || this.queue.length > 0) return;
    this.show();
    this.set({ phase: 'done' });
    const onDone = this.onDone;
    this.onDone = undefined;
    onDone?.();
  }
}
