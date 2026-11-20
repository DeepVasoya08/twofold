import { useEffect, useMemo, useRef, useState } from 'react';

import type { SpaceKeys } from '@arcafold/crypto';
import { photoOrder } from '@arcafold/core/people/edits';
import type { Photo } from '@arcafold/core/library/model';
import type { SearchResults } from '@arcafold/core/search/segment';
import { remoteSearchStore } from '@arcafold/core/search/store';
import type { SearchStore } from '@arcafold/core/search/store';
import type { TaughtWord } from '@arcafold/core/search/taught';

import { RuntimeError } from '../ai/onnx';
import { useScan } from '../ai/use-scan';
import type { ScanInputs, ScanJob, ScanState } from '../ai/use-scan';
import { ResourceError } from './resources';
import { PhotoEncoderError, loadPhotoEncoder, photoNeedsDownload } from './photo-encoder';

export interface SearchIndex {
  /** Whether what was looked at so far (on any device) has loaded. */
  status: 'idle' | 'loading' | 'ready' | 'failed';
  /** The photos a search can find, in the order results are listed. */
  photos: readonly Photo[];
  /** Every vector so far; a new map each time more are shown. */
  results: SearchResults;
  /** Words taught to search (on the web, for now). */
  words: readonly TaughtWord[];
  /** How many of the photos have been looked at, of how many. */
  lookedAt: { done: number; total: number };
  reload: () => void;
  /** Where this phone has got with looking at photos. */
  scan: ScanState;
  downloadNow: () => void;
  retryScan: () => void;
  /** Whether this phone is looking at photos now. */
  active: boolean;
}

/** New vectors are shown at most this often while the phone looks at photos. */
const SHOW_EVERY_MS = 3_000;
/** Saved results are merged once there are more than this many segments. */
const MERGE_AFTER = 8;

const searchJob: ScanJob<Float32Array | null> = {
  needsDownload: photoNeedsDownload,
  load: async (onProgress) => {
    const encoder = await loadPhotoEncoder(onProgress);
    return { look: (picture) => encoder.encode(picture), release: encoder.release };
  },
  // A photo that can't be read has no vector, and isn't tried again.
  empty: null,
  explain: (error) =>
    error instanceof ResourceError ||
    error instanceof PhotoEncoderError ||
    error instanceof RuntimeError
      ? error.message
      : 'Smart search stopped. It will try again next time you unlock.',
  saveFailed: 'Some search results couldn’t be saved. They’ll be worked out again later.',
};

/** Overwrites every vector and empties the map, so nothing worked out outlives a lock. */
function wipe(results: SearchResults): void {
  for (const vector of results.values()) vector?.fill(0);
  results.clear();
}

/**
 * Smart search's index for the open space, on the phone: what each photo shows, worked out
 * by any of your devices and sealed under the space's own key. It loads when this phone
 * looks at photos (`on`) or a search is opened (`wanted`); while `on`, this phone looks at
 * every photo no device has looked at yet, while the app is open and nothing else is
 * `busy`. Held in memory only, and wiped when the library locks.
 */
export function useSearchIndex({
  keys,
  photos,
  on,
  wanted,
  busy,
  previews,
  makeStore = remoteSearchStore,
}: {
  keys: SpaceKeys;
  /** The photos a search can find. */
  photos: readonly Photo[];
  on: boolean;
  wanted: boolean;
  busy: boolean;
  previews: ScanInputs<Float32Array | null>['previews'];
  makeStore?: (keys: SpaceKeys) => SearchStore;
}): SearchIndex {
  const store = useMemo(() => makeStore(keys), [makeStore, keys]);
  const [asked, setAsked] = useState(on || wanted);
  if ((on || wanted) && !asked) setAsked(true);
  const [round, setRound] = useState(0);
  const [loaded, setLoaded] = useState<{
    store: SearchStore;
    round: number;
    ok: boolean;
    words: TaughtWord[];
  } | null>(null);
  const [shown, setShown] = useState<{ store: SearchStore; results: SearchResults } | null>(null);
  const live = useRef<SearchResults>(new Map());
  const segments = useRef<string[]>([]);

  useEffect(() => {
    if (!asked) return;
    let current = true;
    store.load().then(
      (saved) => {
        if (!current) return;
        wipe(live.current);
        live.current = saved.results;
        segments.current = saved.segments;
        setShown({ store, results: new Map(saved.results) });
        setLoaded({ store, round, ok: true, words: saved.words });
      },
      () => {
        if (current) setLoaded({ store, round, ok: false, words: [] });
      },
    );
    return () => {
      current = false;
    };
  }, [store, round, asked]);

  // Nothing worked out outlives the library: locking unmounts this.
  useEffect(
    () => () => {
      wipe(live.current);
    },
    [],
  );

  const last = loaded?.store === store ? loaded : null;
  const status: SearchIndex['status'] = !asked
    ? 'idle'
    : last?.round === round
      ? last.ok
        ? 'ready'
        : 'failed'
      : last?.ok
        ? 'ready'
        : 'loading';
  const results = useMemo<SearchResults>(
    () => (shown?.store === store ? shown.results : new Map<string, null>()),
    [shown, store],
  );
  const words = useMemo<TaughtWord[]>(() => last?.words ?? [], [last]);

  const ordered = useMemo(() => {
    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    return photoOrder(photos).flatMap((id) => {
      const photo = byId.get(id);
      return photo ? [photo] : [];
    });
  }, [photos]);
  const lookedAt = useMemo(
    () => ({
      done: ordered.filter((photo) => results.has(photo.id)).length,
      total: ordered.length,
    }),
    [ordered, results],
  );

  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastShown = useRef(0);
  useEffect(
    () => () => {
      if (showTimer.current) clearTimeout(showTimer.current);
    },
    [],
  );

  const ids = useMemo(() => ordered.map((photo) => photo.id), [ordered]);
  const scan = useScan({
    job: searchJob,
    on,
    ready: status === 'ready' && last?.ok === true,
    photos: ids,
    inputs: {
      pending: () => ids.filter((id) => !live.current.has(id)),
      previews,
      onResults: (found) => {
        for (const [id, vector] of found) live.current.set(id, vector);
        showTimer.current ??= setTimeout(
          () => {
            showTimer.current = null;
            lastShown.current = Date.now();
            setShown({ store, results: new Map(live.current) });
          },
          Math.max(0, lastShown.current + SHOW_EVERY_MS - Date.now()),
        );
      },
      save: async (found) => {
        const saved = await store.saveResults(found);
        segments.current = [...segments.current, ...saved];
      },
      afterDone: async () => {
        setShown({ store, results: new Map(live.current) });
        // Merge segments, and drop vectors for photos that are gone, now and then.
        const present = new Set(ids);
        const kept: SearchResults = new Map(
          [...live.current].filter(([photoId]) => present.has(photoId)),
        );
        const stale = live.current.size - kept.size;
        if (segments.current.length > MERGE_AFTER || stale > live.current.size / 5) {
          const fresh = await store.replaceSegments(kept, segments.current).catch(() => null);
          if (fresh) segments.current = fresh;
        }
      },
      busy,
    },
  });

  return {
    status,
    photos: ordered,
    results,
    words,
    lookedAt,
    reload: () => {
      setRound((n) => n + 1);
    },
    scan: scan.scan,
    downloadNow: scan.downloadNow,
    retryScan: scan.retry,
    active: scan.active,
  };
}
