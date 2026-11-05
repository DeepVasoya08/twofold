import type { UploadStatus } from '@arcafold/core/upload/progress';
import type { UploaderState } from '@arcafold/core/upload/uploader';

import { uploadHeadline } from './upload-text';

/** The native side: a foreground service with a progress notification, and a done one. */
export interface UploadServiceLike {
  show: (text: string, done: number, total: number) => void;
  stop: () => void;
  notifyFinished: (title: string, text: string) => void;
}

/** What is watched of an uploader. */
export interface Watched {
  subscribe: (listener: () => void) => () => void;
  getState: () => UploaderState;
}

/**
 * Keeps Android from pausing uploads in the background: while any uploader has photos on
 * their way, a foreground service runs with a progress notification. When the last one is
 * in, the service stops and, if Arcafold isn't on screen, a notification says how it went.
 * Several uploaders can run at once (one per unlock: locking lets the last one finish), so
 * this counts across all of them. The notifications say only counts, never names, and read
 * the same whichever space the photos went to.
 */
export class BackgroundUploads {
  private readonly seen = new Map<Watched, Map<number, UploadStatus>>();
  private running = new Map<Watched, number>();
  private active = false;
  private done = 0;
  private failed = 0;
  private shown = '';

  constructor(
    private readonly service: UploadServiceLike,
    private readonly onScreen: () => boolean,
  ) {}

  /** Follows an uploader until the returned function is called. */
  watch(uploader: Watched): () => void {
    const update = () => {
      this.update(uploader);
    };
    const unsubscribe = uploader.subscribe(update);
    update();
    return () => {
      unsubscribe();
      this.seen.delete(uploader);
      this.running.delete(uploader);
      this.refresh();
    };
  }

  private update(uploader: Watched): void {
    const { items } = uploader.getState();
    const before = this.seen.get(uploader) ?? new Map<number, UploadStatus>();
    const now = new Map<number, UploadStatus>();
    let running = 0;
    for (const item of items) {
      now.set(item.id, item.status);
      if (
        item.status === 'waiting' ||
        item.status === 'encrypting' ||
        item.status === 'uploading'
      ) {
        running += 1;
      }
    }
    this.running.set(uploader, running);
    if (!this.active && running > 0) {
      this.active = true;
      this.done = 0;
      this.failed = 0;
      this.shown = '';
    }
    if (this.active) {
      for (const [id, status] of now) {
        if (before.get(id) === status) continue;
        if (status === 'done') this.done += 1;
        if (status === 'failed') this.failed += 1;
      }
    }
    this.seen.set(uploader, now);
    this.refresh();
  }

  private refresh(): void {
    if (!this.active) return;
    let running = 0;
    for (const count of this.running.values()) running += count;
    const finished = this.done + this.failed;
    const total = finished + running;
    if (running > 0) {
      const text = `${String(finished)} of ${String(total)}`;
      if (text !== this.shown) {
        this.shown = text;
        this.service.show(text, finished, total);
      }
      return;
    }
    this.active = false;
    this.service.stop();
    if (finished > 0 && !this.onScreen()) {
      this.service.notifyFinished(
        'Arcafold',
        uploadHeadline({
          total: finished,
          done: this.done,
          failed: this.failed,
          running: 0,
          percent: 100,
        }),
      );
    }
  }
}
