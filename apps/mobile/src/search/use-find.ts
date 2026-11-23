import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { answerQuery, peopleIndex, searchNames, shownPhotos } from '@arcafold/core/search/answer';
import type { NotLookedAt } from '@arcafold/core/search/answer';
import { clipPrompt } from '@arcafold/core/search/find';
import type { Found } from '@arcafold/core/search/find';
import { parseQuery } from '@arcafold/core/search/query';
import type { ParsedQuery } from '@arcafold/core/search/query';
import type { Group, Person } from '@arcafold/core/people/grouping';

import { loadTextEncoder, wordsNeedDownload } from './text-encoder';
import type { WordsEncoder } from './text-encoder';
import type { SearchIndex } from './use-search-index';

/** Where turning the words into a search vector has got. */
export type WordsState =
  | { state: 'idle' }
  /** The first search with words needs a download: waiting for you to say yes. */
  | { state: 'ask' }
  | { state: 'downloading'; received: number; total: number }
  | { state: 'working' }
  | { state: 'failed'; message: string };

export interface Find {
  /** Whether the search index (photos looked at so far, on any device) has loaded. */
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
  /** What a smart album keeps of this search: what was typed, the parts left out, and the
   * photo "More like this" started from. */
  saved: { text: string; ignore: string[]; like: string | null };
  /** The words' search vector, once worked out (kept with a smart album). */
  wordsVector: Float32Array | null;
  /** Forgets the search (closing the search screen). */
  clear: () => void;
  reloadIndex: () => void;
}

/** Progress is shown at most this often while downloading. */
const SHOW_EVERY_MS = 250;

/**
 * Searching the open space on the phone: what was typed, what it was read as, and what it
 * found, all held in memory only (never saved), so a search can't be found later; locking
 * forgets it with the library. Photos are found by the vectors your devices worked out and
 * sealed (useSearchIndex); the words are turned into a vector here, with the text half
 * downloaded once, after you say yes.
 */
export function useFind({
  index,
  people,
  groups,
  now = () => new Date(),
}: {
  /** What's been looked at so far, and the photos a search can find (useSearchIndex). */
  index: SearchIndex;
  people: readonly Person[];
  /** Every group, hidden ones too. */
  groups: readonly Group[];
  now?: () => Date;
}): Find {
  const { results, words: taught, photos: ordered } = index;

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
    index: index.status,
    lookedAt: index.lookedAt,
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
    saved: { text: submitted ?? '', ignore: [...ignore], like },
    wordsVector,
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
    reloadIndex: index.reload,
  };
}
