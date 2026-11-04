import type { SpaceKeys } from '@arcafold/crypto';
import { SEARCH_SEGMENT_DELETE_MAX } from '@arcafold/types';

import { spaceApi } from '../api';
import type { SpaceApi } from '../api';
import { decodeSegment, encodeSegment, splitResults } from './segment';
import type { SearchResults } from './segment';
import { parseSmartAlbum, smartMeta } from './smart-album';
import type { SmartAlbum } from './smart-album';
import { parseWord, wordMeta } from './taught';
import type { TaughtWord } from './taught';

/**
 * The open space's search vectors, stored in segments sealed under the space's own key, and
 * the words taught to search and smart albums, one sealed record each. Owner-only, so it always uses the space's own token, never a share token; vectors for
 * photos in libraries shared with you are kept here too, in your own space.
 */

/** Largest segment before sealing; padding and the seal must still fit SEARCH_SIZES. */
export const SEGMENT_BYTES = 224 * 1024;

export interface SavedSearch {
  results: SearchResults;
  /** Ids of the segments the results came from, to merge them later. */
  segments: string[];
  words: TaughtWord[];
  smartAlbums: SmartAlbum[];
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
  saveWord: (word: TaughtWord) => Promise<void>;
  deleteWord: (id: string) => Promise<void>;
  saveSmartAlbum: (album: SmartAlbum) => Promise<void>;
  deleteSmartAlbum: (id: string) => Promise<void>;
  /** Forgets every search vector and taught word in the space. */
  forget: () => Promise<void>;
  newId: () => Promise<string>;
}

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function decode(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function remoteSearchStore(
  keys: SpaceKeys,
  makeApi: (token: string) => SpaceApi = spaceApi,
): SearchStore {
  const loadCrypto = () => import('@arcafold/crypto');
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
      const storedWords = api.listWords();
      storedWords.catch(() => undefined);
      const storedAlbums = api.listSmartAlbums();
      storedAlbums.catch(() => undefined);
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
      const words: TaughtWord[] = [];
      for (const stored of (await storedWords).words) {
        const opened = await crypto
          .openOwnerRecord(keys, 'word', stored.id, stored.meta)
          .catch(() => null);
        const word = opened && parseWord(stored.id, decode(opened));
        if (word) words.push(word);
      }
      const smartAlbums: SmartAlbum[] = [];
      for (const stored of (await storedAlbums).albums) {
        const opened = await crypto
          .openOwnerRecord(keys, 'smart-album', stored.id, stored.meta)
          .catch(() => null);
        const album = opened && parseSmartAlbum(stored.id, decode(opened));
        if (album) smartAlbums.push(album);
      }
      return { results, segments, words, smartAlbums };
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

    saveWord: async (word) => {
      const crypto = await loadCrypto();
      const api = await remote();
      const meta = await crypto.sealOwnerRecord(keys, 'word', word.id, encode(wordMeta(word)));
      await api.putWord(word.id, meta);
    },

    deleteWord: async (id) => {
      const api = await remote();
      await api.deleteWord(id);
    },

    saveSmartAlbum: async (album) => {
      const crypto = await loadCrypto();
      const api = await remote();
      const meta = await crypto.sealOwnerRecord(
        keys,
        'smart-album',
        album.id,
        encode(smartMeta(album)),
      );
      await api.putSmartAlbum(album.id, meta);
    },

    deleteSmartAlbum: async (id) => {
      const api = await remote();
      await api.deleteSmartAlbum(id);
    },

    forget: async () => {
      const api = await remote();
      await api.deleteSearchData();
    },

    newId: async () => (await loadCrypto()).newRecordId(),
  };
}

/** Keeps everything in memory: for rendering tests and previews. */
export function memorySearchStore(initial: Partial<SavedSearch> = {}): SearchStore {
  let results: SearchResults = new Map(initial.results);
  const words = new Map((initial.words ?? []).map((word) => [word.id, word]));
  const albums = new Map((initial.smartAlbums ?? []).map((album) => [album.id, album]));
  let next = 0;
  const newId = (prefix = 'segment') => {
    next += 1;
    return `${prefix}-${String(next)}`;
  };
  return {
    load: () =>
      Promise.resolve({
        results: new Map(results),
        segments: [],
        words: [...words.values()],
        smartAlbums: [...albums.values()],
      }),
    saveResults: (added) => {
      for (const [photoId, vector] of added) results.set(photoId, vector);
      return Promise.resolve([newId()]);
    },
    replaceSegments: (kept) => {
      results = new Map(kept);
      return Promise.resolve([newId()]);
    },
    saveWord: (word) => {
      words.set(word.id, word);
      return Promise.resolve();
    },
    deleteWord: (id) => {
      words.delete(id);
      return Promise.resolve();
    },
    saveSmartAlbum: (album) => {
      albums.set(album.id, album);
      return Promise.resolve();
    },
    deleteSmartAlbum: (id) => {
      albums.delete(id);
      return Promise.resolve();
    },
    forget: () => {
      results = new Map();
      words.clear();
      albums.clear();
      return Promise.resolve();
    },
    newId: () => Promise.resolve(newId('word')),
  };
}
