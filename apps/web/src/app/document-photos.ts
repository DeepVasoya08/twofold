import { useMemo } from 'react';

import { documentLooks, lookPrompts } from '../lib/file-sort/looks';
import type { DocumentLook, LookPrompt } from '../lib/file-sort/looks';
import type { SearchResults } from '../lib/search/segment';
import type { VaultState } from './vault';
import { timelinePhotos } from './vault';
import { useSearch } from './search';
import { useDocumentPhotosView } from './views';
import type { Photo } from '@arcafold/core/library/model';

/**
 * Which photos (and scanned files) look like documents, from the search vectors Smart search
 * has worked out on this device. Nothing here is stored: it's worked out again each unlock,
 * in memory, from vectors that are already there.
 */

let prompts: LookPrompt[] | null = null;
/** Looks already worked out, for each set of results, so each vector is compared once. */
const known = new WeakMap<SearchResults, Map<string, DocumentLook | null>>();

/** The look of every photo and file that looks like a document, by id. */
export function useDocumentLooks(): ReadonlyMap<string, DocumentLook> {
  const { enabled, results, progress } = useSearch();
  const ready = progress.done;
  return useMemo(
    () => {
      if (!enabled) return new Map<string, DocumentLook>();
      const all = results();
      prompts ??= lookPrompts();
      let cache = known.get(all);
      if (!cache) {
        cache = new Map();
        known.set(all, cache);
      }
      return documentLooks(all, prompts, cache);
    },
    // `ready` changes as photos are looked at, so new ones are included.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, results, ready],
  );
}

/** Timeline photos that look like documents, newest first. */
export function documentPhotos(
  state: VaultState,
  looks: ReadonlyMap<string, DocumentLook>,
): Photo[] {
  return timelinePhotos(state)
    .filter((photo) => looks.has(photo.id))
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/**
 * The ids to leave out of the Photos timeline: document photos, while "Hide document photos"
 * is on for this device. Empty otherwise.
 */
export function useHiddenFromTimeline(): ReadonlySet<string> {
  const looks = useDocumentLooks();
  const [view] = useDocumentPhotosView();
  return useMemo(() => new Set(view === 'hide' ? looks.keys() : []), [looks, view]);
}
