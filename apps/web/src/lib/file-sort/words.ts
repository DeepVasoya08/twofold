/**
 * Words read from a file, for sorting it: the text split into lower-case words, and the
 * handful that best say what the file is about, which are kept (sealed) with the file so
 * the app can learn from how you sort it.
 */

/** Most words kept with a file. */
export const MAX_KEYWORDS = 16;

/** Longest word kept. */
const MAX_WORD = 20;

/** Common words that say nothing about what a file is. */
const STOPWORDS = new Set(
  (
    'the and for are but not you all any can had her was one our out has him his how its may ' +
    'new now old see two way who did get let put say she too use with this that from they ' +
    'will your have been were what when where which their there them then than some into ' +
    'only other also more most such over very just about after before here these those ' +
    'would could should each page date per via are our ours yours its it’s don’t can’t ' +
    'pdf doc docx txt copy final draft scan scanned img file files untitled document'
  ).split(' '),
);

/**
 * The words in some text, lower case, letters and digits only (any script). Accents are
 * kept: "café" stays "café".
 */
export function wordsIn(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? [];
}

/** Whether a word is worth keeping: not too short, not a common word, not just a number. */
function meaningful(word: string): boolean {
  return (
    word.length >= 3 && word.length <= MAX_WORD && !STOPWORDS.has(word) && !/^\p{N}+$/u.test(word)
  );
}

/**
 * The words that best say what a file is: its name's words first, then the most frequent
 * words in its text, at most MAX_KEYWORDS.
 */
export function keywordsOf(name: string, text: string): string[] {
  const kept: string[] = [];
  const add = (word: string) => {
    if (kept.length < MAX_KEYWORDS && meaningful(word) && !kept.includes(word)) kept.push(word);
  };
  for (const word of wordsIn(name.replace(/\.[^.]*$/, ''))) add(word);
  const counts = new Map<string, number>();
  for (const word of wordsIn(text)) {
    if (meaningful(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const byCount = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [word] of byCount) add(word);
  return kept;
}

/** Checks words read from sealed metadata: a short list of short strings. */
export function parseKeywords(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_KEYWORDS) return undefined;
  const words = value.filter(
    (word): word is string =>
      typeof word === 'string' && word.length > 0 && word.length <= MAX_WORD,
  );
  return words.length === value.length ? words : undefined;
}
