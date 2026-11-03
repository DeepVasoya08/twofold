import { useCallback, useMemo } from 'react';

import { findPhotos } from '../lib/search/find';
import type { Found, PeopleIndex } from '../lib/search/find';
import { parseQuery } from '../lib/search/query';
import type { NamedPerson, NamedWord, ParsedQuery } from '../lib/search/query';
import type { SearchResults } from '../lib/search/segment';
import type { SmartAlbum } from '../lib/search/smart-album';
import { wordVector } from '../lib/search/taught';
import { photoOrder, useGroups, usePeople } from './people';
import { useSearch } from './search';
import { useVault } from './vault';

/**
 * Running a parsed search over the open space, for the search box and for smart albums:
 * the names a search can use, and what a query finds among the photos looked at so far.
 */

/** What a search needs to look like but can't yet, because its photos haven't been looked at. */
export interface NotLookedAt {
  /** The photo "More like this" started from. */
  photo: boolean;
  /** Taught words, by name. */
  words: string[];
}

export interface Answer {
  /** What was found; null with nothing to search, or while something isn't ready. */
  found: Found | null;
  notLookedAt: NotLookedAt;
}

/** Named people and taught words, as the parser takes them. */
export function useNames(): { people: NamedPerson[]; words: NamedWord[] } {
  const { people } = usePeople();
  const { words } = useSearch();
  const named = useMemo(
    () =>
      people
        .filter((person) => person.name !== '')
        .map(({ id, name, me, labels }) => ({ id, name, me, labels })),
    [people],
  );
  const taught = useMemo(() => words.map(({ id, name }) => ({ id, name })), [words]);
  return useMemo(() => ({ people: named, words: taught }), [named, taught]);
}

/**
 * Answers queries over the open space. `wordsVector` is the query's words as a search
 * vector, or null when there are none or they aren't ready yet. The function changes as
 * photos are looked at, so answers kept with useMemo follow it.
 */
export function useAnswer(): (
  query: ParsedQuery | null,
  wordsVector: Float32Array | null,
) => Answer {
  const { state } = useVault();
  const people = usePeople();
  const { groups, hidden } = useGroups();
  const search = useSearch();
  const { results, words } = search;
  const ready = search.progress.done;

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

  const photos = useMemo(() => {
    const byId = new Map(state.photos.map((photo) => [photo.id, photo]));
    return photoOrder(state).flatMap((id) => {
      const photo = byId.get(id);
      return photo ? [photo] : [];
    });
  }, [state]);

  return useCallback(
    (query, wordsVector) => {
      // Only photos' vectors: files' (scans looked at for sorting) never show up as photos.
      const all = results();
      const vectors: SearchResults = new Map();
      for (const photo of photos) {
        const vector = all.get(photo.id);
        if (vector !== undefined) vectors.set(photo.id, vector);
      }
      const looksLike: Float32Array[] = [];
      const notLookedAt: NotLookedAt = { photo: false, words: [] };
      if (query?.like) {
        const vector = vectors.get(query.like);
        if (vector) looksLike.push(vector);
        else notLookedAt.photo = true;
      }
      for (const id of query?.taught ?? []) {
        const word = words.find((each) => each.id === id);
        const vector = word && wordVector(word, vectors);
        if (vector) looksLike.push(vector);
        else if (word) notLookedAt.words.push(word.name);
      }
      const waiting =
        !query ||
        query.chips.length === 0 ||
        (query.what !== '' && !wordsVector) ||
        notLookedAt.photo ||
        notLookedAt.words.length > 0;
      if (waiting) return { found: null, notLookedAt };
      return {
        found: findPhotos({
          query,
          vector: query.what ? wordsVector : null,
          looksLike,
          exclude: new Set(query.like ? [query.like] : []),
          photos,
          people: index,
          vectors,
        }),
        notLookedAt,
      };
    },
    // `ready` changes as photos are looked at, so answers include them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results, words, photos, index, ready],
  );
}

/** The photos on screen, in order: best matches, then the rest once asked for. */
export function shownPhotos(found: Found | null, showMore: boolean): string[] {
  if (!found) return [];
  return found.best.length === 0 ? found.more : [...found.best, ...(showMore ? found.more : [])];
}

export interface SmartAnswer extends Answer {
  query: ParsedQuery;
  /** The words it was saved with no longer read the same (a word or name changed). */
  changed: boolean;
}

/**
 * Runs a smart album's saved search again. Dates are read from when it was saved, and its
 * words use the vector saved with it, so the text half is never needed here.
 */
export function useSmartAlbum(album: SmartAlbum | undefined): SmartAnswer | null {
  const names = useNames();
  const answer = useAnswer();
  return useMemo(() => {
    if (!album) return null;
    const query = parseQuery(album.text, {
      ...names,
      like: album.like,
      now: new Date(album.savedAt),
      ignore: new Set(album.ignore),
    });
    const changed = query.what !== album.what || (album.what !== '' && !album.vector);
    const wordsVector = changed ? null : album.vector;
    return { ...answer(query, wordsVector), query, changed: changed && query.what !== '' };
  }, [album, names, answer]);
}
