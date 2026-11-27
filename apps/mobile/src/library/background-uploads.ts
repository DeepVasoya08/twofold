import { isUploadRunning } from '@arcafold/core/upload/progress';
import type { UploadStatus } from '@arcafold/core/upload/progress';
import type { UploaderState } from '@arcafold/core/upload/uploader';

import { uploadHeadline, uploadNoun } from './upload-text';
import type { UploadNoun } from './upload-text';

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

/** How one uploader is followed. */
export interface WatchOptions {
  /**
   * Whether the notice at the end may count its photos. That notice stays after the app
   * locks, so photos added to the private space never get one: whoever unlocks the main
   * library next would find a notice for photos it doesn't have.
   */
  notice: boolean;
}

/** Following one uploader. Whichever is called first counts; calling again does nothing. */
export interface Watching {
  /** Stops following it. The photos it finished still count once the rest are in. */
  stop: () => void;
  /** Stops following it and takes back everything it counted, as if it had never run. */
  drop: () => void;
}

/** What one uploader has done since the service last started. */
interface Tally {
  /** Each photo's status when last looked at, so each one finishing counts once. */
  statuses: Map<number, UploadStatus>;
  running: number;
  done: number;
  failed: number;
  notice: boolean;
  /** Whether it's still followed. One that isn't keeps its counts until the run ends. */
  followed: boolean;
}

/**
 * Keeps Android from pausing uploads in the background: while any uploader has photos on
 * their way, a foreground service runs with a progress notification. When the last one is
 * in, the service stops and, if Arcafold isn't on screen, a notification says how it went.
 * Several uploaders can run at once (one per unlock: locking lets the main library's last
 * one finish), so this counts across all of them. The notifications say only counts, never
 * names. Photos added to the private space are never in the notice at the end, and stop
 * when it locks (see `closeUploads`), so nothing about them is left in the notification
 * shade once it has.
 */
export class BackgroundUploads {
  /** Every uploader followed, and those that stopped being followed during this run. */
  private readonly tallies = new Set<Tally>();
  private active = false;
  private shown = '';
  /** What the latest uploads the notice counts were, for its wording. */
  private noun: UploadNoun = 'photo';

  constructor(
    private readonly service: UploadServiceLike,
    private readonly onScreen: () => boolean,
  ) {}

  /** Follows an uploader until the returned `stop` or `drop` is called. */
  watch(uploader: Watched, { notice }: WatchOptions): Watching {
    const tally: Tally = {
      statuses: new Map(),
      running: 0,
      done: 0,
      failed: 0,
      notice,
      followed: true,
    };
    this.tallies.add(tally);
    const unsubscribe = uploader.subscribe(() => {
      this.update(uploader, tally);
    });
    this.update(uploader, tally);
    const end = (keepCounts: boolean) => {
      if (!tally.followed) return;
      unsubscribe();
      tally.followed = false;
      tally.running = 0;
      tally.statuses.clear();
      if (!keepCounts) this.tallies.delete(tally);
      this.refresh();
    };
    return {
      stop: () => {
        end(true);
      },
      drop: () => {
        end(false);
      },
    };
  }

  private update(uploader: Watched, tally: Tally): void {
    const { items } = uploader.getState();
    if (tally.notice && items.length > 0) this.noun = uploadNoun(items);
    const statuses = new Map<number, UploadStatus>();
    let running = 0;
    for (const item of items) {
      statuses.set(item.id, item.status);
      if (isUploadRunning(item.status)) running += 1;
    }
    tally.running = running;
    if (!this.active && running > 0) this.start();
    if (this.active) {
      for (const [id, status] of statuses) {
        if (tally.statuses.get(id) === status) continue;
        if (status === 'done') tally.done += 1;
        if (status === 'failed') tally.failed += 1;
      }
    }
    tally.statuses = statuses;
    this.refresh();
  }

  /** A new run counts from nothing. */
  private start(): void {
    this.active = true;
    this.shown = '';
    for (const tally of this.tallies) {
      tally.done = 0;
      tally.failed = 0;
    }
  }

  private refresh(): void {
    if (!this.active) return;
    let running = 0;
    let finished = 0;
    let done = 0;
    let failed = 0;
    for (const tally of this.tallies) {
      running += tally.running;
      finished += tally.done + tally.failed;
      if (tally.notice) {
        done += tally.done;
        failed += tally.failed;
      }
    }
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
    for (const tally of this.tallies) if (!tally.followed) this.tallies.delete(tally);
    this.service.stop();
    if (done + failed > 0 && !this.onScreen()) {
      this.service.notifyFinished(
        'Arcafold',
        uploadHeadline({ total: done + failed, done, failed, running: 0, percent: 100 }, this.noun),
      );
    }
  }
}
