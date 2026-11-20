import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SpaceKeys } from '@arcafold/crypto';
import { answerQuery, peopleIndex, searchNames, shownPhotos } from '@arcafold/core/search/answer';
import type { NotLookedAt } from '@arcafold/core/search/answer';
import { clipPrompt } from '@arcafold/core/search/find';
import type { Found } from '@arcafold/core/search/find';
import { parseQuery } from '@arcafold/core/search/query';
import type { ParsedQuery } from '@arcafold/core/search/query';
import type { SearchResults } from '@arcafold/core/search/segment';
import { remoteSearchStore } from '@arcafold/core/search/store';
import type { SearchStore } from '@arcafold/core/search/store';
import type { TaughtWord } from '@arcafold/core/search/taught';
import { photoOrder } from '@arcafold/core/people/edits';
import type { Group, Person } from '@arcafold/core/people/grouping';
import type { Photo } from '@arcafold/core/library/model';

import { loadTextEncoder, wordsNeedDownload } from './text-encoder';
import type { WordsEncoder } from './text-encoder';

/** Where turning the words into a search vector has got. */
export type WordsState =
  | { state: 'idle' }
  /** The first search with words needs a download: waiting for you to say yes. */
  | { state: 'ask' }
  | { state: 'downloading'; received: number; total: number }
  | { state: 'working' }
  | { state: 'failed'; message: string };

export interface Find {
  /** Whether the search index (photos looked at in your browser) has loaded. */
  index: 'idle' | 'loading' | 'ready' | 'failed';
  /** How many of the photos have been looked at, of how many. */
  lookedAt: { done: number; total: number };
  text: string;
  setText: (text: string) => void;
  /** Searches for what's in the box. */
  submit: () => void;
  /** Starts a search for photos that look like this one. */
  searchLike: (photoId: string) => void;
  /** What the last search was read as; null before the first. */
  query: ParsedQuery | null;
  toggleChip: (key: string) => void;
  words: WordsState;
  /** Says yes to the first download, and searches. */
  allowDownload: () => void;
  retry: () => void;
  found: Found | null;
  notLookedAt: NotLookedAt;
  showMore: boolean;
  setShowMore: (on: boolean) => void;
  /** The photos on screen, in order. */
  shownIds: readonly string[];
  /** Forgets the search (closing the search screen). */
  clear: () => void;
  reloadIndex: () => void;
}

/** Progress is shown at most this often while downloading. */
const SHOW_EVERY_MS = 250;

/**
 * Searching the open space on the phone: what was typed, what it was read as, and what it
 * found, all held in memory only (never saved), so a search can't be found later; locking
 * forgets it with the library. Photos are found by the vectors your browser worked out and
 * sealed; the words are turned into a vector here, with the text half downloaded once, after
 * you say yes. The index loads the first time search opens (`wanted`).
 */
export function useFind({
  keys,
  photos,
  people,
  groups,
  wanted,
  makeStore = remoteSearchStore,
  now = () => new Date(),
}: {
  keys: SpaceKeys;
  /** The photos a search can find. */
  photos: readonly Photo[];
  people: readonly Person[];
  /** Every group, hidden ones too. */
  groups: readonly Group[];
  wanted: boolean;
  makeStore?: (keys: SpaceKeys) => SearchStore;
  now?: () => Date;
}): Find {
  const store = useMemo(() => makeStore(keys), [makeStore, keys]);
  const [asked, setAsked] = useState(wanted);
  if (wanted && !asked) setAsked(true);
  const [round, setRound] = useState(0);
  const [loaded, setLoaded] = useState<{
    store: SearchStore;
    round: number;
    ok: boolean;
    results: SearchResults;
    words: TaughtWord[];
  } | null>(null);

  useEffect(() => {
    if (!asked) return;
    let live = true;
    store.load().then(
      (saved) => {
        if (live) {
          setLoaded({ store, round, ok: true, results: saved.results, words: saved.words });
        }
      },
      () => {
        if (live) setLoaded({ store, round, ok: false, results: new Map(), words: [] });
      },
    );
    return () => {
      live = false;
    };
  }, [store, round, asked]);

  const last = loaded?.store === store ? loaded : null;
  const index: Find['index'] = !asked
    ? 'idle'
    : last?.round === round
      ? last.ok
        ? 'ready'
        : 'failed'
      : last?.ok
        ? 'ready'
        : 'loading';
  const results = useMemo<SearchResults>(() => last?.results ?? new Map<string, null>(), [last]);
  const taught = useMemo<TaughtWord[]>(() => last?.words ?? [], [last]);

  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [ignore, setIgnore] = useState<ReadonlySet<string>>(new Set());
  const [like, setLike] = useState<string | null>(null);
  const [vector, setVector] = useState<{ what: string; vector: Float32Array } | null>(null);
  const [words, setWords] = useState<WordsState>({ state: 'idle' });
  const [allowed, setAllowed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [showMore, setShowMore] = useState(false);
  const encoder = useRef<Promise<WordsEncoder> | null>(null);

  // The text half goes with the library.
  useEffect(
    () => () => {
      void encoder.current?.then((loadedEncoder) => {
        loadedEncoder.release();
      });
      encoder.current = null;
    },
    [],
  );

  const names = useMemo(() => searchNames(people, taught), [people, taught]);
  const query = useMemo(
    () =>
      submitted === null ? null : parseQuery(submitted, { ...names, like, now: now(), ignore }),
    // `now` is read when the query changes, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [submitted, names, like, ignore],
  );

  const what = query?.what ?? '';
  // Saying yes once covers the rest of the time the library is open.
  const needsAsk = useMemo(() => what !== '' && !allowed && wordsNeedDownload(), [what, allowed]);
  useEffect(() => {
    if (!what || needsAsk) return;
    if (vector?.what === what) return;
    let cancelled = false;
    let lastShown = 0;
    encoder.current ??= loadTextEncoder((received, total) => {
      const shownAt = Date.now();
      if (received < total && shownAt - lastShown < SHOW_EVERY_MS) return;
      lastShown = shownAt;
      if (!cancelled) {
        setWords(
          received < total ? { state: 'downloading', received, total } : { state: 'working' },
        );
      }
    });
    encoder.current
      .then((loadedEncoder) => loadedEncoder.encode(clipPrompt(what)))
      .then(
        (found) => {
          if (cancelled) return;
          setVector({ what, vector: found });
          setWords({ state: 'idle' });
        },
        (caught: unknown) => {
          encoder.current = null;
          if (cancelled) return;
          setWords({
            state: 'failed',
            message: caught instanceof Error ? caught.message : 'Search stopped working.',
          });
        },
      );
    return () => {
      cancelled = true;
    };
    // `vector` is read to skip work already done, not to start it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [what, needsAsk, attempt]);

  const whoIsIn = useMemo(() => peopleIndex(groups, people), [groups, people]);
  const ordered = useMemo(() => {
    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    return photoOrder(photos).flatMap((id) => {
      const photo = byId.get(id);
      return photo ? [photo] : [];
    });
  }, [photos]);
  const wordsVector = vector?.what === what ? vector.vector : null;
  const { found, notLookedAt } = useMemo(
    () =>
      answerQuery({
        query,
        wordsVector,
        photos: ordered,
        results,
        words: taught,
        people: whoIsIn,
      }),
    [query, wordsVector, ordered, results, taught, whoIsIn],
  );
  const shownIds = useMemo(() => shownPhotos(found, showMore), [found, showMore]);
  const lookedAt = useMemo(
    () => ({
      done: ordered.filter((photo) => results.has(photo.id)).length,
      total: ordered.length,
    }),
    [ordered, results],
  );

  const restart = () => {
    setWords((current) => (current.state === 'failed' ? { state: 'idle' } : current));
    setIgnore(new Set());
    setShowMore(false);
  };
  const submit = useCallback(() => {
    setWords((current) => (current.state === 'failed' ? { state: 'idle' } : current));
    setSubmitted(text.trim());
    setLike(null);
    setIgnore(new Set());
    setShowMore(false);
  }, [text]);

  return {
    index,
    lookedAt,
    text,
    setText,
    submit,
    searchLike: (photoId) => {
      restart();
      setText('');
      setSubmitted('');
      setLike(photoId);
    },
    query,
    toggleChip: (key) => {
      setShowMore(false);
      if (key === 'like') {
        setLike(null);
        return;
      }
      setIgnore((current) => {
        const next = new Set(current);
        if (!next.delete(key)) next.add(key);
        return next;
      });
    },
    words: needsAsk
      ? { state: 'ask' }
      : !what
        ? { state: 'idle' }
        : words.state === 'idle' && vector?.what !== what
          ? { state: 'working' }
          : words,
    allowDownload: () => {
      setAllowed(true);
    },
    retry: () => {
      setWords({ state: 'idle' });
      setAttempt((n) => n + 1);
    },
    found,
    notLookedAt,
    showMore,
    setShowMore,
    shownIds,
    clear: () => {
      setText('');
      setSubmitted(null);
      setLike(null);
      setIgnore(new Set());
      setShowMore(false);
    },
    reloadIndex: () => {
      setRound((n) => n + 1);
    },
  };
}
