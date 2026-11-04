import { takenIn } from '@arcafold/core/search/query';
import type { When } from '@arcafold/core/search/query';
import { fileExtension, fileKindLabel, fileKindOf } from '@arcafold/core/file-types';
import { categoryLabel } from '@arcafold/core/file-categories';
import { wordsIn } from '@arcafold/core/keywords';
import type { Photo } from '@arcafold/core/library/model';

/**
 * Finding files from the search box, on this device: a file matches when every word typed
 * starts one of its words: its name's, its type's ("pdf", "document"), its category's
 * ("receipts", "medical") or the few words kept from inside it when it was sorted. Nothing
 * needs downloading, so this works with Smart search off too.
 */

/** Words that say nothing about which file is meant. */
const FILLER = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'for',
  'from',
  'in',
  'on',
  'to',
  'with',
  'my',
  'our',
  'me',
  'us',
  'file',
  'files',
  'document',
  'documents',
]);

/** The words a typed search looks for in files, without filler. */
export function searchedWords(text: string): string[] {
  return wordsIn(text).filter((word) => !FILLER.has(word));
}

/** Every word a file can be found by. */
export function fileWords(item: Photo): string[] {
  const file = item.file;
  if (!file) return [];
  const kind = fileKindOf(file.type, file.name);
  return [
    ...wordsIn(file.name),
    fileExtension(file.name),
    ...wordsIn(fileKindLabel(kind)),
    ...(file.category ? wordsIn(categoryLabel(file.category)) : []),
    ...(file.words ?? []),
  ].filter(Boolean);
}

/** "bills" finds "bill": a plural's last s is let go. */
function stem(word: string): string {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/** Whether every searched word starts one of the file's words. */
export function fileMatches(item: Photo, searched: readonly string[]): boolean {
  if (searched.length === 0) return false;
  const own = fileWords(item);
  return searched.every((word) => own.some((candidate) => candidate.startsWith(stem(word))));
}

/**
 * The files a search finds, newest first: those matching every word typed, and those
 * matching the rest of the words when a time was typed too ("bills last month").
 */
export function findFiles(
  files: readonly Photo[],
  typed: string,
  rest: { what: string; when: When | null },
): Photo[] {
  const all = searchedWords(typed);
  const words = searchedWords(rest.what);
  const when = rest.when;
  return files
    .filter(
      (item) =>
        fileMatches(item, all) ||
        (when !== null &&
          takenIn(when, item.takenAt) &&
          (words.length === 0 || fileMatches(item, words))),
    )
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}
