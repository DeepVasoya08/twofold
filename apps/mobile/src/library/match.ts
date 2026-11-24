/** Lower case, without accents, so "Zoë" is found by "zoe". */
function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Whether `text` (an album, file or person's name) matches what's typed in a tab's search
 * field: every word typed appears in it, in any order. Nothing typed matches everything.
 */
export function matchesQuery(text: string, query: string): boolean {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const within = plain(text);
  return words.every((word) => within.includes(word));
}

/** The items whose name matches `query`, in the same order. */
export function filterByName<T>(
  items: readonly T[],
  query: string,
  nameOf: (item: T) => string,
): readonly T[] {
  return query.trim() === '' ? items : items.filter((item) => matchesQuery(nameOf(item), query));
}
