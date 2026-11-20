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

import type { FaceFinder } from '../lib/people/face-finder';
import { runScan } from '../lib/people/face-scan';
import { faceGroupingOn, loadFaceSetting, saveFaceSetting } from '../lib/people/face-setting';
import { peopleEdits, photoOrder as photosNewestFirst } from '@arcafold/core/people/edits';
import type { PeopleChange } from '@arcafold/core/people/edits';
import { groupFaces } from '@arcafold/core/people/grouping';
import type { Group, Person, PersonLabel } from '@arcafold/core/people/grouping';
import type { FaceResults } from '@arcafold/core/people/segment';
import type { Settled } from '../lib/settle-each';
import { useAccount } from './account';
import type { PeopleStore } from '@arcafold/core/people/store';
import { useUploads } from './uploads';
import { useVault } from './vault';
import type { VaultState } from './vault';

/**
 * People in the open space: faces found on this device, grouped on this device, with the
 * results and the user's choices sealed under the space's own key. On when the account said
 * yes to smart features, unless this device turned it off (or on) in Settings. While on, photos without results are looked at in the background,
 * paused while uploads run or the tab is hidden; locking stops it with everything else.
 */

export type PeopleStatus = 'off' | 'loading' | 'scanning' | 'waiting' | 'ready' | 'failed';

/** Results are shown at most this often while scanning, so the page stays smooth. */
const SHOW_EVERY_MS = 1_500;
/** Segments are merged once there are more than this many. */
const MERGE_AFTER = 8;

interface PeopleValue {
  /** Whether this device finds faces. */
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  status: PeopleStatus;
  error: string | null;
  results: FaceResults;
  people: readonly Person[];
  /** Names a group (making it a person if it isn't one yet) and returns the person's id. */
  name: (group: Group, name: string) => Promise<string>;
  /** Puts `from`'s faces into `into` and returns the id of the person they make. */
  merge: (from: Group, into: Group) => Promise<string>;
  setHidden: (group: Group, hidden: boolean) => Promise<string>;
  /** Says this is (or isn't) the person using Arcafold; anyone else marked so stops being. */
  setMe: (group: Group, me: boolean) => Promise<string>;
  setLabels: (group: Group, labels: readonly PersonLabel[]) => Promise<string>;
  /** Says these photos aren't this person. */
  removePhotos: (group: Group, photoIds: readonly string[]) => Promise<Settled<string>>;
  /** Forgets every face and person in the open space, and stops finding faces here. */
  forget: () => Promise<void>;
}

const PeopleContext = createContext<PeopleValue | null>(null);

/** Every photo of the open space that can have faces, newest first. */
export function photoOrder(state: VaultState): string[] {
  return photosNewestFirst(state.photos);
}

const browserStorage = () => (typeof localStorage === 'undefined' ? undefined : localStorage);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function PeopleProvider({
  children,
  store,
  makeFinder,
}: {
  children: ReactNode;
  store: PeopleStore;
  /** Starts the face finder; null where faces can't be found (previews, tests). */
  makeFinder: (() => FaceFinder) | null;
}) {
  const vault = useVault();
  const { running: uploading } = useUploads();
  const { smartFeatures } = useAccount();
  const [preference, setPreference] = useState(() => loadFaceSetting(browserStorage()));
  const enabled = faceGroupingOn(preference, smartFeatures);
  /** What the background scan is doing, once results have loaded. */
  const [phase, setPhase] = useState<'scanning' | 'waiting' | 'ready'>('scanning');
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  /** What's shown: a copy of `live`, taken every so often while scanning. */
  const [results, setResults] = useState<FaceResults>(() => new Map());
  const [loaded, setLoaded] = useState(false);
  /** Every result so far, added to as the scan goes. */
  const live = useRef<FaceResults>(new Map());
  const segments = useRef<string[]>([]);

  // Read by the scan as it goes, so it always sees the current library and uploads.
  const order = useRef<string[]>([]);
  const uploadingNow = useRef(uploading);
  useEffect(() => {
    uploadingNow.current = uploading;
  }, [uploading]);
  const vaultReady = vault.status === 'ready';
  // A finished scan starts again when photos arrive that it hasn't looked at.
  const [round, setRound] = useState(0);
  const finished = useRef(false);
  useEffect(() => {
    order.current = photoOrder(vault.state);
    if (finished.current && order.current.some((id) => !live.current.has(id))) {
      finished.current = false;
      setRound((n) => n + 1);
    }
  }, [vault.state]);

  const setEnabled = useCallback((on: boolean) => {
    saveFaceSetting(browserStorage(), on);
    setPreference(on ? 'on' : 'off');
    setLoaded(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (!enabled || !vaultReady) return;
    let cancelled = false;
    store.load().then(
      (saved) => {
        if (cancelled) return;
        live.current = saved.results;
        segments.current = saved.segments;
        setResults(new Map(saved.results));
        setPeople(saved.people);
        setLoaded(true);
      },
      () => {
        if (!cancelled) setError('Couldn’t load your people. Check your connection and try again.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, vaultReady, store]);

  const { previews } = vault;
  useEffect(() => {
    if (!enabled || !loaded || !makeFinder) return;
    const controller = new AbortController();
    const { signal } = controller;
    let lastShown = 0;
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    const show = () => {
      lastShown = Date.now();
      showTimer = null;
      setResults(new Map(live.current));
    };
    const blocked = () => uploadingNow.current || document.visibilityState === 'hidden';
    finished.current = false;
    void runScan({
      pending: () => order.current.filter((id) => !live.current.has(id)),
      previews,
      finder: makeFinder(),
      onResults: (found) => {
        for (const [id, faces] of found) live.current.set(id, faces);
        showTimer ??= setTimeout(show, Math.max(0, lastShown + SHOW_EVERY_MS - Date.now()));
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
    }).then(async (end) => {
      if (signal.aborted || end === 'stopped') return;
      if (showTimer) clearTimeout(showTimer);
      show();
      setPhase('ready');
      if (end !== 'done') {
        setError(end.error);
        return;
      }
      finished.current = true;
      // Merge segments, and drop results for photos that are gone, now and then.
      const present = new Set(order.current);
      const kept: FaceResults = new Map(
        [...live.current].filter(([photoId]) => present.has(photoId)),
      );
      const stale = live.current.size - kept.size;
      if (segments.current.length > MERGE_AFTER || stale > live.current.size / 5) {
        const fresh = await store.replaceSegments(kept, segments.current).catch(() => null);
        if (fresh) segments.current = fresh;
      }
    });
    return () => {
      controller.abort();
      if (showTimer) clearTimeout(showTimer);
    };
  }, [enabled, loaded, makeFinder, store, previews, round]);

  const status: PeopleStatus = !enabled
    ? 'off'
    : error
      ? 'failed'
      : !loaded
        ? 'loading'
        : makeFinder
          ? phase
          : 'ready';

  const value = useMemo<PeopleValue>(() => {
    const edits = peopleEdits(store);
    const apply = async (change: Promise<PeopleChange>) => {
      const { id, people: after } = await change;
      setPeople(after);
      return id;
    };
    return {
      enabled,
      setEnabled,
      status,
      error,
      results,
      people,
      name: (group, name) => apply(edits.name(people, group, name)),
      merge: (from, into) => apply(edits.merge(people, from, into)),
      setHidden: (group, hidden) => apply(edits.setHidden(people, group, hidden)),
      setMe: (group, me) => apply(edits.setMe(people, group, me)),
      setLabels: (group, labels) => apply(edits.setLabels(people, group, labels)),
      removePhotos: async (group, photoIds) => {
        const { result, people: after } = await edits.removePhotos(people, group, photoIds);
        if (after) setPeople(after);
        return result;
      },
      forget: async () => {
        await store.forget();
        live.current = new Map();
        segments.current = [];
        setResults(new Map());
        setPeople([]);
        setEnabled(false);
      },
    };
  }, [enabled, setEnabled, status, error, results, people, store]);

  return <PeopleContext value={value}>{children}</PeopleContext>;
}

export function usePeople(): PeopleValue {
  const people = useContext(PeopleContext);
  if (!people) throw new Error('usePeople must be used inside PeopleProvider');
  return people;
}

/** Every group in the open space, worked out again only when something changes. */
export function useGroups(): { groups: Group[]; hidden: Group[] } {
  const { results, people } = usePeople();
  const { state } = useVault();
  return useMemo(() => {
    const all = groupFaces(results, people, photoOrder(state));
    const shown = all.filter((group) => group.photoIds.length > 0);
    return {
      groups: shown.filter((group) => !group.person?.hidden),
      hidden: shown.filter((group) => group.person?.hidden === true),
    };
  }, [results, people, state]);
}

/** How far finding faces has got: photos looked at, of all the open space's photos. */
export function usePeopleProgress(): { done: number; total: number } {
  const { results } = usePeople();
  const { state } = useVault();
  return useMemo(() => {
    const done = state.photos.filter((photo) => results.has(photo.id)).length;
    return { done, total: state.photos.length };
  }, [results, state.photos]);
}

/**
 * The photos of one person or group, in the order they're shown; null when `groupId` is
 * null. Groups are only worked out when asked for one.
 */
export function useGroupPhotoIds(groupId: string | null): string[] | null {
  const { results, people } = usePeople();
  const { state } = useVault();
  return useMemo(() => {
    if (groupId === null) return null;
    const group = groupFaces(results, people, photoOrder(state)).find(
      (each) => each.id === groupId,
    );
    return group?.photoIds ?? [];
  }, [groupId, results, people, state]);
}
