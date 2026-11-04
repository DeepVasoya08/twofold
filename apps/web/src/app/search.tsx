import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { runBackgroundScan } from '../lib/background-scan';
import { connection, isPhone } from '../lib/search/device';
import { photosToIndex, waitForWifi, wipeResults } from '../lib/search/index-plan';
import { EncoderError, EncoderStopped } from '../lib/search/photo-encoder';
import type { PhotoEncoder } from '../lib/search/photo-encoder';
import { SEARCH_RESOURCES, resourceCached } from '../lib/search/resources';
import { loadSearchSetting, saveSearchSetting } from '../lib/search/search-setting';
import type { SearchResults } from '@arcafold/core/search/segment';
import type { SmartAlbum } from '@arcafold/core/search/smart-album';
import { centroid, vectorsOf } from '@arcafold/core/search/taught';
import type { TaughtWord } from '@arcafold/core/search/taught';
import { photoOrder, usePeople } from './people';
import type { SearchStore } from '@arcafold/core/search/store';
import { useUploads } from './uploads';
import { useVault } from './vault';
import type { VaultState } from './vault';

/**
 * Smart search's index for the open space: what each photo shows, worked out on this device
 * by CLIP's photo half and sealed under the space's own key. On unless this device turned it
 * off in Settings. While on, photos without a vector are looked at in the background,
 * after face grouping has had its turn and paused while uploads run or the tab is hidden.
 * Phones look at their own new uploads only, and download the resource on Wi-Fi unless the
 * person taps "Download now". Locking unmounts this with the vault, and the vectors held in
 * memory are wiped. It also keeps the words taught to search, and smart albums.
 */

export type SearchStatus = 'off' | 'loading' | 'scanning' | 'waiting' | 'ready' | 'failed';

/** Where downloading the resource has got, while it matters to the person. */
export type SearchDownload =
  | { state: 'none' }
  | { state: 'waiting-for-wifi' }
  | { state: 'downloading'; received: number; total: number }
  | { state: 'paused' };

/** Segments are merged once there are more than this many. */
const MERGE_AFTER = 8;

interface SearchValue {
  /** Whether this device works out search vectors. */
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  status: SearchStatus;
  error: string | null;
  download: SearchDownload;
  /** Downloads now, on whatever network the phone is on. */
  downloadNow: () => void;
  pause: () => void;
  resume: () => void;
  /** Starts again after a failure. */
  retry: () => void;
  /** How many of the open space's photos have been looked at, of how many. */
  progress: { done: number; total: number };
  /** Whether this is a phone, which looks at its own new uploads only. */
  phone: boolean;
  /** Every vector so far. Read it when searching; it changes as photos are looked at. */
  results: () => SearchResults;
  /** Words taught to search in the open space. */
  words: readonly TaughtWord[];
  /** Teaches search a word: a name, and photos that show it. */
  teach: (name: string, photoIds: readonly string[]) => Promise<TaughtWord>;
  forgetWord: (id: string) => Promise<void>;
  /** Searches saved as albums in the open space. */
  smartAlbums: readonly SmartAlbum[];
  /** Saves a search as a smart album, or saves changes to one (by its id). */
  saveSmartAlbum: (album: Omit<SmartAlbum, 'id'> & { id?: string }) => Promise<SmartAlbum>;
  deleteSmartAlbum: (id: string) => Promise<void>;
  /** Forgets every search vector and taught word in the open space. */
  forget: () => Promise<void>;
}

const SearchContext = createContext<SearchValue | null>(null);

const browserStorage = () => (typeof localStorage === 'undefined' ? undefined : localStorage);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

interface NetworkInformationLike extends EventTarget {
  type?: string;
  saveData?: boolean;
}

const networkInfo = (): NetworkInformationLike | undefined =>
  (navigator as Navigator & { connection?: NetworkInformationLike }).connection;

/**
 * What Smart search looks at, in order: every photo, then files with a drawn first page (a
 * PDF's), so scans with no text can be sorted by how they look (app/document-photos.ts).
 */
export function lookOrder(state: VaultState): string[] {
  const files = (state.files ?? [])
    .filter((item) => item.file?.preview && !item.sharedAlbum)
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt))
    .map((item) => item.id);
  return [...photoOrder(state), ...files];
}

/** Progress is shown at most this often while downloading. */
const SHOW_EVERY_MS = 250;

export function SearchProvider({
  children,
  store,
  makeEncoder,
}: {
  children: ReactNode;
  store: SearchStore;
  /** Starts the encoder, reporting download progress; null where it can't run (tests). */
  makeEncoder: ((onProgress: (received: number, total: number) => void) => PhotoEncoder) | null;
}) {
  const vault = useVault();
  const { running: uploading, uploadedHere } = useUploads();
  const { status: peopleStatus } = usePeople();
  const [enabled, setEnabledState] = useState(() => loadSearchSetting(browserStorage()));
  const [loaded, setLoaded] = useState(false);
  const [phase, setPhase] = useState<'scanning' | 'waiting' | 'ready'>('ready');
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState<SearchDownload>({ state: 'none' });
  const [paused, setPaused] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [done, setDone] = useState(0);
  const [words, setWords] = useState<TaughtWord[]>([]);
  const [smartAlbums, setSmartAlbums] = useState<SmartAlbum[]>([]);
  /** Bumped to start the scan again: new photos, Wi-Fi, a retry. */
  const [round, setRound] = useState(0);
  /** Bumped to load again after a failed load. */
  const [loadRound, setLoadRound] = useState(0);
  const live = useRef<SearchResults>(new Map());
  const segments = useRef<string[]>([]);
  const phone = useMemo(() => isPhone(navigator), []);

  // Read by the scan as it goes, so it always sees the current library, uploads and People.
  const order = useRef<string[]>([]);
  const uploadedNow = useRef(uploadedHere);
  const blockedBy = useRef({ uploading, people: peopleStatus });
  useEffect(() => {
    blockedBy.current = { uploading, people: peopleStatus };
  }, [uploading, peopleStatus]);
  const finished = useRef(false);
  const pending = useCallback(
    () =>
      photosToIndex({
        order: order.current,
        done: live.current,
        phone,
        uploadedHere: uploadedNow.current,
      }),
    [phone],
  );
  useEffect(() => {
    order.current = lookOrder(vault.state);
    uploadedNow.current = uploadedHere;
    setDone(order.current.filter((id) => live.current.has(id)).length);
    if (finished.current && pending().length > 0) {
      finished.current = false;
      setRound((n) => n + 1);
    }
  }, [vault.state, uploadedHere, pending]);

  // A phone waiting for Wi-Fi starts when it gets there.
  useEffect(() => {
    const info = networkInfo();
    if (!info) return;
    const changed = () => {
      if (connection(navigator) === 'wifi') setRound((n) => n + 1);
    };
    info.addEventListener('change', changed);
    return () => {
      info.removeEventListener('change', changed);
    };
  }, []);

  // Nothing worked out outlives the vault: locking unmounts this.
  useEffect(
    () => () => {
      wipeResults(live.current);
    },
    [],
  );

  const setEnabled = useCallback((on: boolean) => {
    saveSearchSetting(browserStorage(), on);
    setEnabledState(on);
    setLoaded(false);
    setError(null);
    setPaused(false);
    if (!on) {
      wipeResults(live.current);
      setWords([]);
      setSmartAlbums([]);
    }
  }, []);

  const vaultReady = vault.status === 'ready';
  useEffect(() => {
    if (!enabled || !vaultReady) return;
    let cancelled = false;
    store.load().then(
      (saved) => {
        if (cancelled) return;
        live.current = saved.results;
        segments.current = saved.segments;
        setWords(saved.words);
        setSmartAlbums(saved.smartAlbums);
        setDone(order.current.filter((id) => saved.results.has(id)).length);
        setLoaded(true);
      },
      () => {
        if (!cancelled)
          setError('Couldn’t load Smart search. Check your connection and try again.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, vaultReady, store, loadRound]);

  const { previews } = vault;
  useEffect(() => {
    if (!enabled || !loaded || !makeEncoder || paused || error) return;
    const controller = new AbortController();
    const { signal } = controller;
    // A function, so checks after an await see the abort.
    const stopped = () => signal.aborted;
    let lastShown = 0;
    const blocked = () =>
      blockedBy.current.uploading ||
      blockedBy.current.people === 'scanning' ||
      blockedBy.current.people === 'loading' ||
      document.visibilityState === 'hidden';

    void (async () => {
      finished.current = false;
      if (pending().length === 0) {
        finished.current = true;
        setPhase('ready');
        return;
      }
      const cached = phone && (await resourceCached(SEARCH_RESOURCES.photo));
      if (stopped()) return;
      if (waitForWifi({ phone, connection: connection(navigator), cached, allowed })) {
        setDownload({ state: 'waiting-for-wifi' });
        setPhase('waiting');
        return;
      }
      const encoder = makeEncoder((received, total) => {
        if (stopped()) return;
        const now = Date.now();
        if (received < total && now - lastShown < SHOW_EVERY_MS) return;
        lastShown = now;
        setDownload(
          received < total ? { state: 'downloading', received, total } : { state: 'none' },
        );
      });
      const end = await runBackgroundScan<Float32Array | null>({
        pending,
        previews,
        looker: {
          look: (image) => encoder.encode(image),
          stop: () => {
            encoder.stop();
          },
        },
        empty: null,
        prepare: () => encoder.load(),
        onResults: (found) => {
          for (const [id, vector] of found) live.current.set(id, vector);
          setDownload({ state: 'none' });
          setDone(order.current.filter((id) => live.current.has(id)).length);
        },
        save: async (found) => {
          const ids = await store.saveResults(found);
          segments.current = [...segments.current, ...ids];
        },
        ready: async () => {
          setPhase('scanning');
          while (blocked() && !signal.aborted) {
            setPhase('waiting');
            await sleep(1_000);
          }
          setPhase('scanning');
        },
        wait: sleep,
        signal,
        explain: (caught) => {
          if (caught instanceof EncoderStopped) return null;
          if (caught instanceof EncoderError) return caught.message;
          return 'Smart search stopped. It will try again next time you unlock.';
        },
        saveFailed: 'Some search results couldn’t be saved. They’ll be worked out again later.',
      });
      if (stopped() || end === 'stopped') return;
      setPhase('ready');
      setDownload({ state: 'none' });
      if (end !== 'done') {
        setError(end.error);
        return;
      }
      finished.current = true;
      // Merge segments, and drop vectors for photos that are gone, now and then.
      const present = new Set(order.current);
      const kept: SearchResults = new Map(
        [...live.current].filter(([photoId]) => present.has(photoId)),
      );
      const stale = live.current.size - kept.size;
      if (segments.current.length > MERGE_AFTER || stale > live.current.size / 5) {
        const fresh = await store.replaceSegments(kept, segments.current).catch(() => null);
        if (fresh) segments.current = fresh;
      }
    })();
    return () => {
      controller.abort();
    };
  }, [
    enabled,
    loaded,
    makeEncoder,
    paused,
    error,
    allowed,
    phone,
    pending,
    previews,
    store,
    round,
  ]);

  const status: SearchStatus = !enabled
    ? 'off'
    : error
      ? 'failed'
      : !loaded
        ? 'loading'
        : makeEncoder
          ? phase
          : 'ready';

  const value = useMemo<SearchValue>(
    () => ({
      enabled,
      setEnabled,
      status,
      error,
      download: enabled && !error ? download : { state: 'none' },
      downloadNow: () => {
        setAllowed(true);
        setDownload({ state: 'none' });
      },
      pause: () => {
        setPaused(true);
        setDownload({ state: 'paused' });
      },
      resume: () => {
        setPaused(false);
        setDownload({ state: 'none' });
      },
      retry: () => {
        setError(null);
        setRound((n) => n + 1);
        if (!loaded) setLoadRound((n) => n + 1);
      },
      progress: { done, total: vault.state.photos.length },
      phone,
      results: () => live.current,
      words,
      teach: async (name, photoIds) => {
        const word: TaughtWord = {
          id: await store.newId(),
          name: name.trim(),
          photos: [...photoIds],
          vector: centroid(vectorsOf(photoIds, live.current)),
        };
        await store.saveWord(word);
        setWords((current) => [...current, word]);
        return word;
      },
      forgetWord: async (id) => {
        await store.deleteWord(id);
        setWords((current) => current.filter((word) => word.id !== id));
      },
      smartAlbums,
      saveSmartAlbum: async (changes) => {
        const album: SmartAlbum = { ...changes, id: changes.id ?? (await store.newId()) };
        await store.saveSmartAlbum(album);
        setSmartAlbums((current) =>
          current.some((each) => each.id === album.id)
            ? current.map((each) => (each.id === album.id ? album : each))
            : [...current, album],
        );
        return album;
      },
      deleteSmartAlbum: async (id) => {
        await store.deleteSmartAlbum(id);
        setSmartAlbums((current) => current.filter((album) => album.id !== id));
      },
      forget: async () => {
        await store.forget();
        wipeResults(live.current);
        segments.current = [];
        setWords([]);
        setSmartAlbums([]);
        setDone(0);
        setEnabled(false);
      },
    }),
    [
      enabled,
      setEnabled,
      status,
      error,
      download,
      done,
      vault.state.photos.length,
      phone,
      loaded,
      store,
      words,
      smartAlbums,
    ],
  );

  return <SearchContext value={value}>{children}</SearchContext>;
}

export function useSearch(): SearchValue {
  const search = useContext(SearchContext);
  if (!search) throw new Error('useSearch must be used inside SearchProvider');
  return search;
}
