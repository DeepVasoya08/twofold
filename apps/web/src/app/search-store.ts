import type { SpaceKeys } from '@twofold/crypto';
import { SEARCH_SEGMENT_DELETE_MAX } from '@twofold/types';

import { spaceApi } from '../lib/api';
import type { SpaceApi } from '../lib/api';
import { decodeSegment, encodeSegment, splitResults } from '../lib/search/segment';
import type { SearchResults } from '../lib/search/segment';

/**
 * The open space's search vectors, stored in segments sealed under the space's own key.
 * Owner-only, so it always uses the space's own token, never a share token; vectors for
 * photos in libraries shared with you are kept here too, in your own space.
 */

/** Largest segment before sealing; padding and the seal must still fit SEARCH_SIZES. */
export const SEGMENT_BYTES = 224 * 1024;

export interface SavedSearch {
  results: SearchResults;
  /** Ids of the segments the results came from, to merge them later. */
  segments: string[];
}

export interface SearchStore {
  load: () => Promise<SavedSearch>;
  /** Saves vectors for some photos, as one new segment or more, and returns their ids. */
  saveResults: (results: SearchResults) => Promise<string[]>;
  /**
   * Replaces segments with new ones holding `results` (usually everything still wanted), and
   * returns the new ones' ids. They're saved first, so a failure part way loses nothing.
   */
  replaceSegments: (results: SearchResults, old: readonly string[]) => Promise<string[]>;
  /** Forgets every search vector in the space. */
  forget: () => Promise<void>;
}

export function remoteSearchStore(
  keys: SpaceKeys,
  makeApi: (token: string) => SpaceApi = spaceApi,
): SearchStore {
  const loadCrypto = () => import('@twofold/crypto');
  let apiPromise: Promise<SpaceApi> | null = null;
  const remote = () =>
    (apiPromise ??= loadCrypto().then((crypto) => makeApi(crypto.spaceToken(keys))));

  const saveSegments = async (results: SearchResults) => {
    const crypto = await loadCrypto();
    const api = await remote();
    const ids: string[] = [];
    for (const part of splitResults(results, SEGMENT_BYTES)) {
      const id = await crypto.newRecordId();
      await api.putSearchSegment(id, await crypto.sealSearchSegment(keys, id, encodeSegment(part)));
      ids.push(id);
    }
    return ids;
  };

  return {
    load: async () => {
      const crypto = await loadCrypto();
      const api = await remote();
      const results: SearchResults = new Map();
      const segments: string[] = [];
      let after: string | undefined;
      do {
        const page = await api.listSearchSegments(after);
        for (const stored of page.segments) {
          segments.push(stored.id);
          // A segment that doesn't open, or came from another model, is merged away later.
          const opened = await crypto
            .openSearchSegment(keys, stored.id, stored.data)
            .catch(() => null);
          const decoded = opened && decodeSegment(opened);
          if (!decoded) continue;
          for (const [photoId, vector] of decoded) results.set(photoId, vector);
        }
        after = page.next ?? undefined;
      } while (after);
      return { results, segments };
    },

    saveResults: saveSegments,

    replaceSegments: async (results, old) => {
      const api = await remote();
      const ids = await saveSegments(results);
      for (let start = 0; start < old.length; start += SEARCH_SEGMENT_DELETE_MAX) {
        await api.deleteSearchSegments(old.slice(start, start + SEARCH_SEGMENT_DELETE_MAX));
      }
      return ids;
    },

    forget: async () => {
      const api = await remote();
      await api.deleteSearchData();
    },
  };
}

/** Keeps everything in memory: for rendering tests and previews. */
export function memorySearchStore(initial: Partial<SavedSearch> = {}): SearchStore {
  let results: SearchResults = new Map(initial.results);
  let next = 0;
  const newId = () => {
    next += 1;
    return `segment-${String(next)}`;
  };
  return {
    load: () => Promise.resolve({ results: new Map(results), segments: [] }),
    saveResults: (added) => {
      for (const [photoId, vector] of added) results.set(photoId, vector);
      return Promise.resolve([newId()]);
    },
    replaceSegments: (kept) => {
      results = new Map(kept);
      return Promise.resolve([newId()]);
    },
    forget: () => {
      results = new Map();
      return Promise.resolve();
    },
  };
}
