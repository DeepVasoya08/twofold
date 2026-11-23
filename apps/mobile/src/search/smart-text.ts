import { MAX_SMART_TITLE, smartAlbumFits } from '@arcafold/core/search/smart-album';
import type { SmartAlbum } from '@arcafold/core/search/smart-album';
import type { ParsedQuery } from '@arcafold/core/search/query';
import { MAX_EXAMPLES, MIN_EXAMPLES, wordNameProblem } from '@arcafold/core/search/taught';

/** What a name sheet's check gives: the name to save, or why it can't be. */
export type Checked = { title: string } | { error: string };

/**
 * Why these many photos can't teach a word, or null if they can: a word is taught with a
 * few photos that show the same thing.
 */
export function teachCountProblem(count: number): string | null {
  if (count >= MIN_EXAMPLES && count <= MAX_EXAMPLES) return null;
  return `Choose ${String(MIN_EXAMPLES)} to ${String(MAX_EXAMPLES)} photos that show the same thing, like a pet or a place, then tap Teach.`;
}

/** Checks a new word's name against the names people and words already have. */
export function wordCheck(taken: {
  people: readonly string[];
  words: readonly string[];
}): (name: string) => Checked {
  return (name) => {
    const problem = wordNameProblem(name, taken);
    return problem ? { error: problem } : { title: name.trim() };
  };
}

/** Checks a smart album's title, and that the search fits in one sealed record with it. */
export function smartTitleCheck(
  album: Omit<SmartAlbum, 'id' | 'title'>,
): (name: string) => Checked {
  return (name) => {
    const title = name.trim();
    if (!title) return { error: 'Give your album a name.' };
    if (title.length > MAX_SMART_TITLE) {
      return { error: `Keep the name to ${String(MAX_SMART_TITLE)} characters or fewer.` };
    }
    if (!smartAlbumFits({ ...album, title, id: '' })) {
      return { error: 'This search is too long to save as an album.' };
    }
    return { title };
  };
}

/** What a smart album keeps of a search: as typed, read as of `now`, with its words' vector. */
export function searchToSave(
  find: {
    saved: { text: string; ignore: string[]; like: string | null };
    query: Pick<ParsedQuery, 'what'> | null;
    wordsVector: Float32Array | null;
  },
  now: Date = new Date(),
): Omit<SmartAlbum, 'id' | 'title'> {
  const what = find.query?.what ?? '';
  return {
    ...find.saved,
    savedAt: now.toISOString(),
    what,
    vector: what ? find.wordsVector : null,
  };
}
