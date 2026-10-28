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

import { clipPrompt, findPhotos } from '../lib/search/find';
import type { Found, PeopleIndex } from '../lib/search/find';
import { EncoderStopped } from '../lib/search/photo-encoder';
import type { QueryEncoder } from '../lib/search/query-encoder';
import { parseQuery } from '../lib/search/query';
import type { NamedPerson, NamedWord, ParsedQuery } from '../lib/search/query';
import { wordVector } from '../lib/search/taught';
import { photoOrder, useGroups, usePeople } from './people';
import { useSearch } from './search';
import { useVault } from './vault';

/**
 * The search box's state for the open space: what was typed, what it was read as, and what
 * it found. It's all held here, in memory, and never in the URL or the browser's storage,
 * so a search can't be found later; locking unmounts it with the vault. The text half (for
 * the words in a query) is downloaded on the first search that has words, and kept until
 * lock. Once it's loaded on a quick device, results follow the typing; otherwise they come
 * when the search is sent. "More like this" starts a search from a photo instead.
 */

/** Where turning words into a search vector has got. */
export type WordsState =
  | { state: 'idle' }
  | { state: 'downloading'; received: number; total: number }
  | { state: 'working' }
  | { state: 'failed'; message: string };

/** Encoding a query faster than this lets results follow the typing. */
const QUICK_MS = 250;
/** How long typing has to pause before a quick device searches. */
const TYPING_PAUSE_MS = 300;
/** Progress is shown at most this often while downloading. */
const SHOW_EVERY_MS = 250;

interface FindValue {
  /** What's in the search box. */
  text: string;
  setText: (text: string) => void;
  /** Searches for what's in the box now. */
  submit: () => void;
  /** Starts a new search for photos that look like this one. */
  searchLike: (photoId: string) => void;
  /** What the last search was read as; null before the first. */
  query: ParsedQuery | null;
  /** Taps a chip off (or back on), searching again without that part. */
  toggleChip: (key: string) => void;
  words: WordsState;
  /** Tries the words again after the text half failed to load. */
  retry: () => void;
  /** What was found; null while waiting for the words, or with nothing to search. */
  found: Found | null;
  showMore: boolean;
  setShowMore: (on: boolean) => void;
  /** The photos on screen, in order: the viewer steps through these. */
  shownIds: readonly string[];
  /** Why words can't be searched here, if they can't. */
  wordsOff: 'off' | 'unavailable' | null;
  /**
   * What the search needs to look like but can't yet, because its photos haven't been looked
   * at: the photo "More like this" started from, and taught words (by name).
   */
  notLookedAt: NotLookedAt;
}

export interface NotLookedAt {
  photo: boolean;
  words: string[];
}

const FindContext = createContext<FindValue | null>(null);

export function FindProvider({
  children,
  makeQueryEncoder,
  now = () => new Date(),
}: {
  children: ReactNode;
  /** Starts the query encoder, reporting download progress; null where it can't run. */
  makeQueryEncoder:
    ((onProgress: (received: number, total: number) => void) => QueryEncoder) | null;
  now?: () => Date;
}) {
  const { state } = useVault();
  const people = usePeople();
  const { groups, hidden } = useGroups();
  const search = useSearch();
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [ignore, setIgnore] = useState<ReadonlySet<string>>(new Set());
  const [vector, setVector] = useState<{ what: string; vector: Float32Array } | null>(null);
  const [words, setWords] = useState<WordsState>({ state: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const [showMore, setShowMore] = useState(false);
  const [quick, setQuick] = useState(false);
  const [like, setLike] = useState<string | null>(null);
  const encoder = useRef<QueryEncoder | null>(null);

  // Nothing typed outlives the vault.
  useEffect(
    () => () => {
      encoder.current?.stop();
      encoder.current = null;
    },
    [],
  );

  const named = useMemo<NamedPerson[]>(
    () =>
      people.people
        .filter((person) => person.name !== '')
        .map(({ id, name, me, labels }) => ({ id, name, me, labels })),
    [people.people],
  );
  const taught = useMemo<NamedWord[]>(
    () => search.words.map(({ id, name }) => ({ id, name })),
    [search.words],
  );
  const query = useMemo(
    () =>
      submitted === null
        ? null
        : parseQuery(submitted, { people: named, words: taught, like, now: now(), ignore }),
    // `now` is read when the query changes, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [submitted, named, taught, like, ignore],
  );

  const wordsOff = !search.enabled ? 'off' : makeQueryEncoder ? null : 'unavailable';
  const what = query?.what ?? '';
  useEffect(() => {
    if (!what || wordsOff || !makeQueryEncoder) return;
    if (vector?.what === what) return;
    let cancelled = false;
    let lastShown = 0;
    encoder.current ??= makeQueryEncoder((received, total) => {
      const shownAt = Date.now();
      if (received < total && shownAt - lastShown < SHOW_EVERY_MS) return;
      lastShown = shownAt;
      setWords(received < total ? { state: 'downloading', received, total } : { state: 'working' });
    });
    const started = Date.now();
    encoder.current.encode(clipPrompt(what)).then(
      (found) => {
        if (cancelled) return;
        setQuick(Date.now() - started < QUICK_MS);
        setVector({ what, vector: found });
        setWords({ state: 'idle' });
      },
      (caught: unknown) => {
        if (cancelled || caught instanceof EncoderStopped) return;
        encoder.current?.stop();
        encoder.current = null;
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
  }, [what, wordsOff, makeQueryEncoder, attempt]);

  // Results follow the typing on a quick device that has the text half loaded.
  useEffect(() => {
    if (!quick || submitted === null || text === submitted) return;
    const timer = setTimeout(() => {
      setSubmitted(text);
      setIgnore(new Set());
      setShowMore(false);
    }, TYPING_PAUSE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [quick, text, submitted]);

  const index = useMemo<PeopleIndex>(() => {
    const inPhoto = new Map<string, Set<string>>();
    for (const group of [...groups, ...hidden]) {
      for (const photoId of group.photoIds) {
        const found = inPhoto.get(photoId) ?? new Set<string>();
        found.add(group.id);
        inPhoto.set(photoId, found);
      }
    }
    return {
      inPhoto,
      meId: people.people.find((person) => person.me)?.id ?? null,
      labelsOf: new Map(people.people.map((person) => [person.id, person.labels])),
    };
  }, [groups, hidden, people.people]);

  const ready = search.progress.done;
  const { results, words: taughtWords } = search;
  /** What the photos must look like, and what can't be looked for yet. */
  const looks = useMemo(() => {
    const vectors = results();
    const looksLike: Float32Array[] = [];
    const missing: NotLookedAt = { photo: false, words: [] };
    if (query?.like) {
      const vector = vectors.get(query.like);
      if (vector) looksLike.push(vector);
      else missing.photo = true;
    }
    for (const id of query?.taught ?? []) {
      const word = taughtWords.find((each) => each.id === id);
      const vector = word && wordVector(word, vectors);
      if (vector) looksLike.push(vector);
      else if (word) missing.words.push(word.name);
    }
    return { looksLike, missing };
    // `ready` changes as photos are looked at, so missing ones are tried again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, taughtWords, results, ready]);
  const found = useMemo<Found | null>(() => {
    if (!query || query.chips.length === 0) return null;
    const wordsVector = query.what ? (vector?.what === query.what ? vector.vector : null) : null;
    if (query.what && !wordsVector) return null;
    if (looks.missing.photo || looks.missing.words.length > 0) return null;
    const byId = new Map(state.photos.map((photo) => [photo.id, photo]));
    const photos = photoOrder(state).flatMap((id) => {
      const photo = byId.get(id);
      return photo ? [photo] : [];
    });
    return findPhotos({
      query,
      vector: wordsVector,
      looksLike: looks.looksLike,
      exclude: new Set(query.like ? [query.like] : []),
      photos,
      people: index,
      vectors: results(),
    });
    // `ready` changes as photos are looked at, so results include them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, vector, looks, state, index, results, ready]);

  const shownIds = useMemo(
    () =>
      !found
        ? []
        : found.best.length === 0
          ? found.more
          : [...found.best, ...(showMore ? found.more : [])],
    [found, showMore],
  );

  const submit = useCallback(() => {
    // A failure is tried again with each new search.
    setWords((current) => (current.state === 'failed' ? { state: 'idle' } : current));
    setSubmitted(text);
    setIgnore(new Set());
    setShowMore(false);
  }, [text]);

  const searchLike = useCallback((photoId: string) => {
    setWords((current) => (current.state === 'failed' ? { state: 'idle' } : current));
    setText('');
    setSubmitted('');
    setLike(photoId);
    setIgnore(new Set());
    setShowMore(false);
  }, []);

  const value = useMemo<FindValue>(
    () => ({
      text,
      setText,
      submit,
      searchLike,
      query,
      toggleChip: (key) => {
        // A photo tapped off is gone, rather than coming back with the next search.
        if (key === 'like') {
          setLike(null);
          setShowMore(false);
          return;
        }
        setIgnore((current) => {
          const next = new Set(current);
          if (!next.delete(key)) next.add(key);
          return next;
        });
        setShowMore(false);
      },
      // Waiting on the words, with nothing more to say, is "working".
      words:
        !what || wordsOff
          ? { state: 'idle' }
          : words.state === 'idle' && vector?.what !== what
            ? { state: 'working' }
            : words,
      retry: () => {
        setWords({ state: 'idle' });
        setAttempt((n) => n + 1);
      },
      found,
      showMore,
      setShowMore,
      shownIds,
      wordsOff,
      notLookedAt: looks.missing,
    }),
    [
      text,
      submit,
      searchLike,
      query,
      what,
      wordsOff,
      words,
      vector,
      found,
      showMore,
      shownIds,
      looks,
    ],
  );

  return <FindContext value={value}>{children}</FindContext>;
}

export function useFind(): FindValue {
  const find = useContext(FindContext);
  if (!find) throw new Error('useFind must be used inside FindProvider');
  return find;
}
