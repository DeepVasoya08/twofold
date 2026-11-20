import { useCallback, useMemo } from 'react';

import { answerQuery, peopleIndex, searchNames } from '@arcafold/core/search/answer';
import type { Answer } from '@arcafold/core/search/answer';
import { parseQuery } from '@arcafold/core/search/query';
import type { NamedPerson, NamedWord, ParsedQuery } from '@arcafold/core/search/query';
import type { SmartAlbum } from '@arcafold/core/search/smart-album';
import { photoOrder, useGroups, usePeople } from './people';
import { useSearch } from './search';
import { useVault } from './vault';

/**
 * Running a parsed search over the open space, for the search box and for smart albums:
 * the names a search can use, and what a query finds among the photos looked at so far.
 */

export type { Answer, NotLookedAt } from '@arcafold/core/search/answer';
export { shownPhotos } from '@arcafold/core/search/answer';

/** Named people and taught words, as the parser takes them. */
export function useNames(): { people: NamedPerson[]; words: NamedWord[] } {
  const { people } = usePeople();
  const { words } = useSearch();
  return useMemo(() => searchNames(people, words), [people, words]);
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

  const index = useMemo(
    () => peopleIndex([...groups, ...hidden], people.people),
    [groups, hidden, people.people],
  );

  const photos = useMemo(() => {
    const byId = new Map(state.photos.map((photo) => [photo.id, photo]));
    return photoOrder(state).flatMap((id) => {
      const photo = byId.get(id);
      return photo ? [photo] : [];
    });
  }, [state]);

  return useCallback(
    (query, wordsVector) =>
      answerQuery({ query, wordsVector, photos, results: results(), words, people: index }),
    // `ready` changes as photos are looked at, so answers include them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results, words, photos, index, ready],
  );
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
