import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SpaceKeys } from '@arcafold/crypto';
import { peopleEdits, photoOrder } from '@arcafold/core/people/edits';
import type { PeopleChange } from '@arcafold/core/people/edits';
import { groupFaces } from '@arcafold/core/people/grouping';
import type { Group, Person, PersonLabel } from '@arcafold/core/people/grouping';
import type { FaceResults } from '@arcafold/core/people/segment';
import { remotePeopleStore } from '@arcafold/core/people/store';
import type { PeopleStore } from '@arcafold/core/people/store';
import type { Photo } from '@arcafold/core/library/model';
import type { Settled } from '@arcafold/core/settle-each';

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
}

/** What People says when nobody shows yet. */
export function noPeopleText(hiddenOnly: boolean): string {
  if (hiddenOnly) return 'Nobody is hidden.';
  return 'Someone shows up here once their face is found in at least 3 photos. For now, faces are found by Arcafold in your browser, with face grouping on in Settings.';
}

/** Splits groups into those shown and those hidden; groups with no photos left drop out. */
export function shownGroups(
  results: FaceResults,
  people: readonly Person[],
  photos: readonly Pick<Photo, 'id' | 'takenAt'>[],
): { groups: Group[]; hidden: Group[] } {
  const all = groupFaces(results, people, photoOrder(photos)).filter(
    (group) => group.photoIds.length > 0,
  );
  return {
    groups: all.filter((group) => !group.person?.hidden),
    hidden: all.filter((group) => group.person?.hidden === true),
  };
}

/** A person's photos, in the order they're shown, from the library's photos. */
export function personPhotos(group: Group, byId: ReadonlyMap<string, Photo>): Photo[] {
  return group.photoIds.flatMap((id) => {
    const photo = byId.get(id);
    return photo ? [photo] : [];
  });
}

/**
 * The people in the open space: faces found on any of your devices, grouped here, with what
 * you named, merged or hid saved in sealed records. Loaded the first time People is opened
 * (`wanted`), and kept while the space stays open.
 */
export function usePeople(
  keys: SpaceKeys,
  photos: readonly Photo[],
  wanted: boolean,
  makeStore: (keys: SpaceKeys) => PeopleStore = remotePeopleStore,
): People {
  const store = useMemo(() => makeStore(keys), [makeStore, keys]);
  const [results, setResults] = useState<FaceResults>(() => new Map());
  const [people, setPeople] = useState<Person[]>([]);
  const [round, setRound] = useState(0);
  /** How the last load of this store went. */
  const [loaded, setLoaded] = useState<{ store: PeopleStore; round: number; ok: boolean } | null>(
    null,
  );
  // Once People has been opened, the people stay loaded.
  const [asked, setAsked] = useState(wanted);
  if (wanted && !asked) setAsked(true);
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
    let live = true;
    store.load().then(
      (saved) => {
        if (!live) return;
        setResults(saved.results);
        setPeople(saved.people);
        setLoaded({ store, round, ok: true });
      },
      () => {
        if (live) setLoaded({ store, round, ok: false });
      },
    );
    return () => {
      live = false;
    };
  }, [store, round, asked]);

  const { groups, hidden } = useMemo(
    () => shownGroups(results, people, photos),
    [results, people, photos],
  );

  const reload = useCallback(() => {
    setRound((n) => n + 1);
  }, []);

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
  };
}
