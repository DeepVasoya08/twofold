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

import { clipPrompt } from '../lib/search/find';
import type { Found } from '../lib/search/find';
import { EncoderStopped } from '../lib/search/photo-encoder';
import type { QueryEncoder } from '../lib/search/query-encoder';
import { parseQuery } from '../lib/search/query';
import type { ParsedQuery } from '../lib/search/query';
import { shownPhotos, useAnswer, useNames } from './answer';
import type { NotLookedAt } from './answer';
import { useSearch } from './search';

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
  /** What was last searched for, with what was tapped off and the photo it started from. */
  saved: { text: string; ignore: string[]; like: string | null } | null;
  /** The last search's words as a search vector, once worked out. */
  wordsVector: Float32Array | null;
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

  const names = useNames();
  const query = useMemo(
    () =>
      submitted === null ? null : parseQuery(submitted, { ...names, like, now: now(), ignore }),
    // `now` is read when the query changes, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [submitted, names, like, ignore],
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

  const answer = useAnswer();
  const wordsVector = vector?.what === what ? vector.vector : null;
  const { found, notLookedAt } = useMemo(
    () => answer(query, wordsVector),
    [answer, query, wordsVector],
  );
  const shownIds = useMemo(() => shownPhotos(found, showMore), [found, showMore]);

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
      saved: submitted === null ? null : { text: submitted, ignore: [...ignore], like },
      wordsVector,
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
      notLookedAt,
    }),
    [
      text,
      submit,
      searchLike,
      query,
      submitted,
      ignore,
      like,
      wordsVector,
      what,
      wordsOff,
      words,
      vector,
      found,
      showMore,
      shownIds,
      notLookedAt,
    ],
  );

  return <FindContext value={value}>{children}</FindContext>;
}

export function useFind(): FindValue {
  const find = useContext(FindContext);
  if (!find) throw new Error('useFind must be used inside FindProvider');
  return find;
}
