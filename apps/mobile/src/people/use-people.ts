import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SpaceKeys } from '@arcafold/crypto';
import { peopleEdits, photoOrder } from '@arcafold/core/people/edits';
import type { PeopleChange } from '@arcafold/core/people/edits';
import type { Group, Person, PersonLabel } from '@arcafold/core/people/grouping';
import type { FaceResults, StoredFace } from '@arcafold/core/people/segment';
import { remotePeopleStore } from '@arcafold/core/people/store';
import type { PeopleStore } from '@arcafold/core/people/store';
import type { Photo } from '@arcafold/core/library/model';
import type { Settled } from '@arcafold/core/settle-each';

import { shownGroups } from './people-view';
import { RuntimeError } from '../ai/onnx';
import { useScan } from '../ai/use-scan';
import type { ScanInputs, ScanJob, ScanState } from '../ai/use-scan';
import { ResourceError } from '../search/resources';
import { FaceFinderError, facesNeedDownload, loadFaceFinder } from './face-finder';

export { noPeopleText, personPhotos, shownGroups } from './people-view';

export interface People {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  /** The person records: names, "This is me", labels. */
  people: readonly Person[];
  /** Everyone shown in People, and those hidden from it. */
  groups: Group[];
  hidden: Group[];
  /** Loads the people again (after a failure, or to pick up faces found elsewhere). */
  reload: () => void;
  /** Each change resolves with the id of the person it made or changed. */
  name: (group: Group, name: string) => Promise<string>;
  merge: (from: Group, into: Group) => Promise<string>;
  setHidden: (group: Group, hidden: boolean) => Promise<string>;
  setMe: (group: Group, me: boolean) => Promise<string>;
  setLabels: (group: Group, labels: readonly PersonLabel[]) => Promise<string>;
  /** Says these photos aren't this person. */
  removePhotos: (group: Group, photoIds: readonly string[]) => Promise<Settled<string>>;
  /** How many photos have been looked at for faces (on any device), of how many. */
  lookedAt: { done: number; total: number };
  /** Where this phone has got with finding faces. */
  scan: ScanState;
  downloadNow: () => void;
  retryScan: () => void;
  /** Whether this phone is finding faces now (Smart search waits for it). */
  active: boolean;
}

/** New faces are grouped and shown at most this often while the phone finds them. */
const SHOW_EVERY_MS = 5_000;
/** Saved results are merged once there are more than this many segments. */
const MERGE_AFTER = 8;

const faceJob: ScanJob<StoredFace[]> = {
  needsDownload: facesNeedDownload,
  load: async (onProgress) => {
    const finder = await loadFaceFinder(onProgress);
    return { look: (picture) => finder.find(picture), release: finder.release };
  },
  // A preview that's missing or can't be read has no faces to find.
  empty: [],
  explain: (error) =>
    error instanceof ResourceError ||
    error instanceof FaceFinderError ||
    error instanceof RuntimeError
      ? error.message
      : 'Finding faces stopped. It will try again next time you unlock.',
  saveFailed: 'Some face results couldn’t be saved. They’ll be found again later.',
};

/**
 * The people in the open space: faces found on any of your devices, grouped here, with what
 * you named, merged or hid saved in sealed records. Loaded when this phone finds faces
 * (`on`) or People is first opened (`wanted`), and kept while the space stays open. While
 * `on`, this phone finds faces in every photo no device has looked at yet, while the app is
 * open and nothing else is `busy`.
 */
export function usePeople({
  keys,
  photos,
  on,
  wanted,
  busy,
  previews,
  makeStore = remotePeopleStore,
}: {
  keys: SpaceKeys;
  photos: readonly Photo[];
  on: boolean;
  wanted: boolean;
  busy: boolean;
  previews: ScanInputs<StoredFace[]>['previews'];
  makeStore?: (keys: SpaceKeys) => PeopleStore;
}): People {
  const store = useMemo(() => makeStore(keys), [makeStore, keys]);
  const [results, setResults] = useState<FaceResults>(() => new Map());
  const live = useRef<FaceResults>(new Map());
  const segments = useRef<string[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [round, setRound] = useState(0);
  /** How the last load of this store went. */
  const [loaded, setLoaded] = useState<{ store: PeopleStore; round: number; ok: boolean } | null>(
    null,
  );
  // Once People has been opened, the people stay loaded.
  const [asked, setAsked] = useState(on || wanted);
  if ((on || wanted) && !asked) setAsked(true);
  const last = loaded?.store === store ? loaded : null;
  // A reload keeps showing what loaded before; after a failure it shows loading again.
  const status: People['status'] = !asked
    ? 'idle'
    : last?.round === round
      ? last.ok
        ? 'ready'
        : 'failed'
      : last?.ok
        ? 'ready'
        : 'loading';

  useEffect(() => {
    if (!asked) return;
    let current = true;
    store.load().then(
      (saved) => {
        if (!current) return;
        live.current = saved.results;
        segments.current = saved.segments;
        setResults(new Map(saved.results));
        setPeople(saved.people);
        setLoaded({ store, round, ok: true });
      },
      () => {
        if (current) setLoaded({ store, round, ok: false });
      },
    );
    return () => {
      current = false;
    };
  }, [store, round, asked]);

  const { groups, hidden } = useMemo(
    () => shownGroups(results, people, photos),
    [results, people, photos],
  );

  const reload = useCallback(() => {
    setRound((n) => n + 1);
  }, []);

  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastShown = useRef(0);
  useEffect(
    () => () => {
      if (showTimer.current) clearTimeout(showTimer.current);
    },
    [],
  );
  const ids = useMemo(() => photoOrder(photos), [photos]);
  const lookedAt = useMemo(
    () => ({ done: ids.filter((id) => results.has(id)).length, total: ids.length }),
    [ids, results],
  );
  const scan = useScan({
    job: faceJob,
    on,
    ready: status === 'ready' && last?.ok === true,
    photos: ids,
    inputs: {
      pending: () => ids.filter((id) => !live.current.has(id)),
      previews,
      onResults: (found) => {
        for (const [id, faces] of found) live.current.set(id, faces);
        showTimer.current ??= setTimeout(
          () => {
            showTimer.current = null;
            lastShown.current = Date.now();
            setResults(new Map(live.current));
          },
          Math.max(0, lastShown.current + SHOW_EVERY_MS - Date.now()),
        );
      },
      save: async (found) => {
        const saved = await store.saveResults(found);
        segments.current = [...segments.current, ...saved];
      },
      afterDone: async () => {
        setResults(new Map(live.current));
        // Merge segments, and drop results for photos that are gone, now and then.
        const present = new Set(ids);
        const kept: FaceResults = new Map(
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

  const edits = useMemo(() => peopleEdits(store), [store]);
  const apply = useCallback(async (change: Promise<PeopleChange>) => {
    const { id, people: after } = await change;
    setPeople(after);
    return id;
  }, []);

  return {
    status,
    people,
    groups,
    hidden,
    reload,
    name: (group, name) => apply(edits.name(people, group, name)),
    merge: (from, into) => apply(edits.merge(people, from, into)),
    setHidden: (group, value) => apply(edits.setHidden(people, group, value)),
    setMe: (group, me) => apply(edits.setMe(people, group, me)),
    setLabels: (group, labels) => apply(edits.setLabels(people, group, labels)),
    removePhotos: async (group, photoIds) => {
      const { result, people: after } = await edits.removePhotos(people, group, photoIds);
      if (after) setPeople(after);
      return result;
    },
    lookedAt,
    scan: scan.scan,
    downloadNow: scan.downloadNow,
    retryScan: scan.retry,
    active: scan.active,
  };
}
