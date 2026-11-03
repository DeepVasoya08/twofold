import type { Category } from './categories';

/**
 * Learning from how you sort: every file you've moved to a category is an example, kept as
 * its category and its words in its own sealed metadata. A new file that shares enough words
 * with your examples goes where they went. Nothing is stored besides those files' records.
 */
export interface SortExample {
  category: Category;
  words: readonly string[];
}

/** Fewest shared words, and share of the smaller list, for an example to count. */
const MIN_SHARED = 2;
const MIN_OVERLAP = 0.4;

/** How alike two word lists are: 0 when too little is shared, else the share of the smaller. */
export function likeness(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const other = new Set(b);
  const shared = a.filter((word) => other.has(word)).length;
  const overlap = shared / Math.min(a.length, b.length);
  return shared >= MIN_SHARED && overlap >= MIN_OVERLAP ? overlap : 0;
}

/** The category your examples point to for these words, or null if none is alike enough. */
export function sortByExamples(
  words: readonly string[],
  examples: readonly SortExample[],
): Category | null {
  const votes = new Map<Category, number>();
  for (const example of examples) {
    const score = likeness(words, example.words);
    if (score > 0) votes.set(example.category, (votes.get(example.category) ?? 0) + score);
  }
  let best: Category | null = null;
  let bestScore = 0;
  for (const [category, score] of votes) {
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return best;
}
