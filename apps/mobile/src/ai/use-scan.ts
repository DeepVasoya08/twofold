import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { runBackgroundScan } from '@arcafold/core/background-scan';
import type { BackgroundScanDeps } from '@arcafold/core/background-scan';
import type { Picture } from '@arcafold/core/picture';

import { BackupJob } from '../../modules/backup-job';
import { withPicture } from './picture';

/** Where the phone has got with looking at photos (for search, or for faces). */
export type ScanState =
  | { state: 'off' }
  /** Results so far are loading. */
  | { state: 'loading' }
  /** Every photo has been looked at. */
  | { state: 'done' }
  /** Waiting for Wi-Fi to download the resources, or for "Download now". */
  | { state: 'waiting-for-wifi' }
  | { state: 'downloading'; received: number; total: number }
  | { state: 'scanning' }
  /** Waiting while photos upload, the other kind of scan runs, or the app is out of sight. */
  | { state: 'paused' }
  | { state: 'failed'; message: string };

/** The models that look at one photo, loaded. */
export interface Looker<T> {
  look: (picture: Picture) => Promise<T>;
  release: () => void;
}

/** What one kind of scan needs: its models, and what it says when things go wrong. */
export interface ScanJob<T> {
  /** Whether loading would download resources first (and so should wait for Wi-Fi). */
  needsDownload: () => boolean;
  /** Downloads (if needed) and loads the models. */
  load: (onProgress: (received: number, total: number) => void) => Promise<Looker<T>>;
  /** The result for a photo whose preview is missing or can't be read. */
  empty: T;
  /** What to say when an error ends the scan. */
  explain: (error: unknown) => string;
  saveFailed: string;
}

/** What the scan reads as it goes: always the latest, so new photos are picked up. */
export interface ScanInputs<T> {
  /** Photos still to look at, in order. */
  pending: () => readonly string[];
  previews: BackgroundScanDeps<T>['previews'];
  onResults: (found: Map<string, T>) => void;
  save: (found: Map<string, T>) => Promise<void>;
  /** Runs after every photo has been looked at (merging saved results, say). */
  afterDone?: () => Promise<void>;
  /** Whether to wait: photos uploading, or the other scan running. */
  busy: boolean;
}

/** Progress is shown at most this often while downloading. */
const SHOW_EVERY_MS = 250;
/** How often a scan waiting for Wi-Fi checks for it. */
const WIFI_CHECK_MS = 30_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Looks at the open space's photos in the background, with the shared scan from
 * @arcafold/core: only while the app is open and unlocked (locking unmounts it), never while
 * `busy`, and only after `ready` (results so far have loaded). The resources download on
 * Wi-Fi, or on any network once you say so. `photos` changing starts a finished scan again
 * when there's something new to look at.
 */
export function useScan<T>({
  job,
  on,
  ready,
  inputs,
  photos,
}: {
  job: ScanJob<T>;
  on: boolean;
  ready: boolean;
  inputs: ScanInputs<T>;
  photos: unknown;
}): {
  scan: ScanState;
  downloadNow: () => void;
  retry: () => void;
  /** Whether it's working through photos now (the other scan waits for it). */
  active: boolean;
} {
  const latest = useRef(inputs);
  useEffect(() => {
    latest.current = inputs;
  });
  const [phase, setPhase] = useState<ScanState>({ state: 'loading' });
  const [allowed, setAllowed] = useState(false);
  const [round, setRound] = useState(0);
  const finished = useRef(false);

  // A finished scan starts again when photos arrive that it hasn't looked at.
  useEffect(() => {
    if (finished.current && latest.current.pending().length > 0) {
      finished.current = false;
      setRound((n) => n + 1);
    }
  }, [photos]);

  useEffect(() => {
    if (!on || !ready) return;
    const controller = new AbortController();
    const { signal } = controller;
    // A function, so checks after an await see the abort.
    const stopped = () => signal.aborted;
    let looker: Looker<T> | null = null;
    let wifiTimer: ReturnType<typeof setTimeout> | null = null;
    let lastShown = 0;

    void (async () => {
      finished.current = false;
      if (latest.current.pending().length === 0) {
        finished.current = true;
        setPhase({ state: 'done' });
        return;
      }
      if (job.needsDownload() && !allowed && !BackupJob.unmetered()) {
        setPhase({ state: 'waiting-for-wifi' });
        wifiTimer = setTimeout(() => {
          setRound((n) => n + 1);
        }, WIFI_CHECK_MS);
        return;
      }
      setPhase({ state: 'scanning' });
      const end = await runBackgroundScan<T>({
        pending: () => latest.current.pending(),
        previews: (ids, onPreview) => latest.current.previews(ids, onPreview),
        prepare: async () => {
          looker = await job.load((received, total) => {
            if (stopped()) return;
            const now = Date.now();
            if (received < total && now - lastShown < SHOW_EVERY_MS) return;
            lastShown = now;
            setPhase(
              received < total ? { state: 'downloading', received, total } : { state: 'scanning' },
            );
          });
        },
        looker: {
          look: async (bytes) => {
            const loaded = looker;
            if (!loaded) throw new Error('Not loaded');
            return withPicture(bytes, (picture) => loaded.look(picture));
          },
          stop: () => {
            looker?.release();
            looker = null;
          },
        },
        empty: job.empty,
        onResults: (found) => {
          latest.current.onResults(found);
        },
        save: (found) => latest.current.save(found),
        ready: async () => {
          const waiting = () => latest.current.busy || AppState.currentState !== 'active';
          while (waiting() && !stopped()) {
            setPhase({ state: 'paused' });
            await sleep(1_000);
          }
          if (!stopped()) setPhase({ state: 'scanning' });
        },
        wait: sleep,
        signal,
        explain: (error) => job.explain(error),
        saveFailed: job.saveFailed,
      });
      if (stopped() || end === 'stopped') return;
      if (end !== 'done') {
        setPhase({ state: 'failed', message: end.error });
        return;
      }
      finished.current = true;
      setPhase({ state: 'done' });
      await latest.current.afterDone?.().catch(() => undefined);
    })();

    return () => {
      controller.abort();
      if (wifiTimer) clearTimeout(wifiTimer);
    };
  }, [job, on, ready, allowed, round]);

  const downloadNow = useCallback(() => {
    setAllowed(true);
  }, []);
  const retry = useCallback(() => {
    setPhase({ state: 'loading' });
    setRound((n) => n + 1);
  }, []);

  const scan: ScanState = !on ? { state: 'off' } : !ready ? { state: 'loading' } : phase;
  return {
    scan,
    downloadNow,
    retry,
    active: scan.state === 'scanning' || scan.state === 'downloading',
  };
}
