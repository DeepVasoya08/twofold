import { isVideoFile } from '@arcafold/core/file-types';
import { isUploadRunning } from '../lib/upload-progress';
import type { UploadStatus } from '../lib/upload-progress';
import { canStartUpload } from '../lib/upload-queue';
import type { InFlight } from '../lib/upload-queue';
import type { Photo } from '@arcafold/core/library/model';
import { errorMessage } from '@arcafold/core/errors';
import type { NewPhoto, UploadStage } from '@arcafold/core/library/space-store';

/**
 * The upload queue for the open space, kept outside React so that closing the upload dialog,
 * moving around the app or switching browser tabs doesn't stop photos on their way. Each
 * photo is encrypted on this device, then the ciphertext is uploaded, up to three photos at
 * a time (fewer when they're big; see lib/upload-queue.ts), in the order they were added.
 * Stored photos are held back and handed over together once the queue runs dry, so the
 * library (and the storage figure worked out from it) changes once, not after every photo.
 */

/** Why a video is turned away. */
export const VIDEO_REFUSED = 'Videos can’t be added yet.';

export interface UploadItem {
  id: number;
  name: string;
  /**
   * In-memory object URL of the small preview, once the photo has been read; never written
   * to storage. Originals are never shown, so dropping hundreds of photos stays light.
   */
  url: string;
  /** Whether it's a file that isn't a photo, shown with a file icon instead of a preview. */
  file?: boolean;
  status: UploadStatus;
  error?: string;
}

export interface UploaderState {
  /** Every photo added since the list last started over. */
  items: readonly UploadItem[];
  /** Whether the upload dialog is showing. */
  dialogOpen: boolean;
}

export interface UploaderDeps {
  /**
   * Reads a file into what is stored: a photo's original bytes and a small preview, or any
   * other file's bytes and its name.
   */
  prepare: (file: File) => Promise<NewPhoto>;
  /** Encrypts and stores a photo in the open space, without showing it yet. */
  upload: (
    photo: NewPhoto,
    albumId: string | undefined,
    onStage: (stage: UploadStage) => void,
  ) => Promise<Photo>;
  /** Called once each time the queue runs dry, with every photo stored since the last time. */
  onStored: (photos: Photo[]) => void;
  /** Makes and drops in-memory preview URLs (object URLs in the browser). */
  preview: { make: (bytes: Uint8Array<ArrayBuffer>) => string; revoke: (url: string) => void };
}

interface Job {
  id: number;
  file: File;
  albumId: string | undefined;
}

export class Uploader {
  private state: UploaderState = { items: [], dialogOpen: false };
  private readonly listeners = new Set<() => void>();
  private queue: Job[] = [];
  private inFlight: InFlight = { count: 0, bytes: 0 };
  /** Photos stored since the queue last ran dry, shown together at the end. */
  private stored: Photo[] = [];
  private nextId = 0;
  /** Every preview URL made, so clearing revokes them all, even one made as it cleared. */
  private readonly previews = new Set<string>();

  constructor(private deps: UploaderDeps) {}

  /** Swaps in the latest vault and toast; uploads already running keep their own. */
  connect(deps: UploaderDeps): void {
    this.deps = deps;
  }

  getState = (): UploaderState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get running(): boolean {
    return this.state.items.some((item) => isUploadRunning(item.status));
  }

  openDialog = (): void => {
    this.set({ dialogOpen: true });
  };

  /** Hides the dialog. Photos already added keep uploading. */
  closeDialog = (): void => {
    this.set({ dialogOpen: false });
    // The list has been seen; one still uploading stays, for the progress indicator.
    if (!this.running) this.clear();
  };

  /**
   * Queues photos and files; `albumId` adds photos to that album as well as the timeline.
   * Videos are shown as refused and never read.
   */
  add = (files: readonly File[], albumId: string | undefined): void => {
    if (files.length === 0) return;
    const added = files.map((file): UploadItem => {
      this.nextId += 1;
      const id = this.nextId;
      if (isVideoFile(file)) {
        return { id, name: file.name, url: '', status: 'failed', error: VIDEO_REFUSED };
      }
      this.queue.push({ id, file, albumId });
      return { id, name: file.name, url: '', status: 'waiting' };
    });
    this.set({ items: [...this.state.items, ...added] });
    this.pump();
  };

  /** Drops the photos that haven't started. Those already uploading finish. */
  cancelWaiting = (): void => {
    const dropped = new Set(this.queue.map((job) => job.id));
    this.queue = [];
    this.set({ items: this.state.items.filter((item) => !dropped.has(item.id)) });
    this.settle();
  };

  /** Stops what hasn't started and forgets the list, as when the vault locks. */
  dispose(): void {
    this.queue = [];
    this.stored = [];
    this.clear();
  }

  private clear(): void {
    for (const url of this.previews) this.deps.preview.revoke(url);
    this.previews.clear();
    this.set({ items: [] });
  }

  private set(change: Partial<UploaderState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }

  private listed(id: number): boolean {
    return this.state.items.some((item) => item.id === id);
  }

  private update(id: number, change: Partial<UploadItem>): void {
    // A photo dropped from the list (as the vault locked) stays dropped.
    if (!this.listed(id)) return;
    this.set({
      items: this.state.items.map((item) => (item.id === id ? { ...item, ...change } : item)),
    });
  }

  private async uploadOne({ id, file, albumId }: Job): Promise<void> {
    const { prepare, upload, preview } = this.deps;
    try {
      this.update(id, { status: 'encrypting' });
      const photo = await prepare(file);
      if (!this.listed(id)) return;
      if (photo.file && !photo.file.preview) {
        // A file's stand-in preview isn't an image: show its icon, never the bytes.
        this.update(id, { file: true });
      } else {
        const url = preview.make(photo.thumb);
        this.previews.add(url);
        this.update(id, { url, ...(photo.file && { file: true }) });
      }
      const stored = await upload(photo, albumId, (stage) => {
        this.update(id, { status: stage });
      });
      this.update(id, { status: 'done' });
      // Locking while it uploaded dropped the list; the photo shows on the next unlock.
      if (this.listed(id)) this.stored.push(stored);
    } catch (error) {
      this.update(id, { status: 'failed', error: errorMessage(error) });
    }
  }

  /** Starts queued photos while there's room, in order. */
  private pump(): void {
    for (let job = this.queue[0]; job; job = this.queue[0]) {
      const size = job.file.size;
      if (!canStartUpload(this.inFlight, size)) break;
      this.queue.shift();
      this.inFlight = { count: this.inFlight.count + 1, bytes: this.inFlight.bytes + size };
      void this.uploadOne(job).finally(() => {
        this.inFlight = { count: this.inFlight.count - 1, bytes: this.inFlight.bytes - size };
        this.pump();
      });
    }
    this.settle();
  }

  /** Once the queue runs dry: the new photos all at once, and a closed dialog starts over. */
  private settle(): void {
    if (this.inFlight.count > 0 || this.queue.length > 0) return;
    if (this.stored.length > 0) {
      const stored = this.stored;
      this.stored = [];
      this.deps.onStored(stored);
    }
    // Failures stay, so the progress indicator can point at them until they've been seen.
    const failed = this.state.items.some((item) => item.status === 'failed');
    if (!this.state.dialogOpen && !failed) this.clear();
  }
}
