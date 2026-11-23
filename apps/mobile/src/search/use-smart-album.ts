import { useMemo } from 'react';

import { answerQuery, peopleIndex, searchNames } from '@arcafold/core/search/answer';
import type { NotLookedAt } from '@arcafold/core/search/answer';
import type { Found } from '@arcafold/core/search/find';
import { parseQuery } from '@arcafold/core/search/query';
import type { ParsedQuery } from '@arcafold/core/search/query';
import type { SmartAlbum } from '@arcafold/core/search/smart-album';
import type { Group, Person } from '@arcafold/core/people/grouping';

import type { SearchIndex } from './use-search-index';

export interface SmartAnswer {
  query: ParsedQuery;
  found: Found | null;
  notLookedAt: NotLookedAt;
  /**
   * Whether part of the search reads differently now (a word or name changed since it was
   * saved), so its words can't be matched until it's saved again.
   */
  changed: boolean;
}

/**
 * A smart album's photos, found again each time it's opened, the way the web does: its
 * search read as of when it was saved (so "last year" keeps meaning that year), with the
 * words' vector it kept, over every photo looked at so far.
 */
export function useSmartAlbum({
  album,
  index,
  people,
  groups,
}: {
  album: SmartAlbum | undefined;
  index: Pick<SearchIndex, 'photos' | 'results' | 'words'>;
  people: readonly Person[];
  groups: readonly Group[];
}): SmartAnswer | null {
  const { photos, results, words } = index;
  const names = useMemo(() => searchNames(people, words), [people, words]);
  const whoIsIn = useMemo(() => peopleIndex(groups, people), [groups, people]);
  return useMemo(() => {
    if (!album) return null;
    const query = parseQuery(album.text, {
      ...names,
      like: album.like,
      now: new Date(album.savedAt),
      ignore: new Set(album.ignore),
    });
    const changed = query.what !== album.what || (album.what !== '' && !album.vector);
    const { found, notLookedAt } = answerQuery({
      query,
      wordsVector: changed ? null : album.vector,
      photos,
      results,
      words,
      people: whoIsIn,
    });
    return { query, found, notLookedAt, changed: changed && query.what !== '' };
  }, [album, names, whoIsIn, photos, results, words]);
}
