import type { Find } from './use-find';

/**
 * A line about the search index, when it matters: loading, failed, or not looked at yet.
 * Photos are looked at by Arcafold in a browser for now; people and dates work regardless.
 */
export function searchStatus(find: Pick<Find, 'index' | 'lookedAt'>): string | null {
  switch (find.index) {
    case 'idle':
    case 'loading':
      return 'Getting search ready…';
    case 'failed':
      return 'Couldn’t load search. Check your connection. People and dates still work.';
    case 'ready':
      if (find.lookedAt.total > 0 && find.lookedAt.done === 0) {
        return 'None of your photos have been looked at for search yet. For now, Arcafold in your browser looks at them, with Smart search on. People and dates still work.';
      }
      return null;
  }
}
