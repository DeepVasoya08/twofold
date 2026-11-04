import { docxText, readText } from '../document-text';
import { fileExtension, fileKindOf } from '@arcafold/core/file-types';
import { TILE_BUDGET_MS, withinBudget } from '../file-preview';
import type { PreviewTier } from '../file-preview';
import type { Category } from '@arcafold/core/file-categories';
import { sortByExamples } from './learn';
import type { SortExample } from './learn';
import { sortByWords } from './rules';
import { keywordsOf } from '@arcafold/core/keywords';

/**
 * Sorting a file into a category on the device that adds it, before it is encrypted: its
 * text is read (a PDF's first pages, a Word document's paragraphs, a text file), scored by
 * words, and checked against how you've sorted files before. Only the category and a few
 * words are kept, sealed in the file's record; the text itself is let go.
 */

/** Most characters of text looked at. */
const TEXT_MAX = 200_000;

/** Most PDF pages read, by tier. */
const PDF_PAGES: Record<PreviewTier, number> = { full: 20, light: 5 };

export interface Sorted {
  category: Category;
  /** The words that best say what it is, kept to learn from (see learn.ts). */
  words: string[];
}

/**
 * The text of a file, as far as this device can read it in time. Empty when the file has
 * no text it can read (images, spreadsheets) or reading it failed.
 */
export async function textForSorting(
  bytes: Uint8Array<ArrayBuffer>,
  type: string,
  name: string,
  tier: PreviewTier,
): Promise<string> {
  const kind = fileKindOf(type, name);
  let read: Promise<string> | null = null;
  if (kind === 'text') read = Promise.resolve(readText(bytes.subarray(0, TEXT_MAX)).text);
  else if (fileExtension(name) === 'docx') {
    read = docxText(bytes).then((paragraphs) => paragraphs.join('\n'));
  } else if (kind === 'pdf' && typeof document !== 'undefined') {
    read = (async () => {
      const { openPdf, pdfText, closePdf } = await import('../pdf');
      const doc = await openPdf(bytes);
      try {
        return await pdfText(doc, PDF_PAGES[tier]);
      } finally {
        closePdf(doc);
      }
    })();
  }
  if (!read) return '';
  const text = await withinBudget(read, TILE_BUDGET_MS[tier]);
  return (text ?? '').slice(0, TEXT_MAX);
}

/** Notes are plain text and Markdown files nothing else claims. */
function isNote(type: string, name: string): boolean {
  return (
    fileKindOf(type, name) === 'text' && ['txt', 'md', 'markdown', ''].includes(fileExtension(name))
  );
}

/**
 * The category for a file: where files like it went when you sorted them, else what its
 * words point to, else Notes for a plain text file, else Other (never a guess).
 */
export function sortFile(
  name: string,
  type: string,
  text: string,
  examples: readonly SortExample[],
): Sorted {
  const words = keywordsOf(name, text);
  const category =
    sortByExamples(words, examples) ??
    sortByWords(name, text) ??
    (isNote(type, name) ? 'notes' : 'other');
  return { category, words };
}
