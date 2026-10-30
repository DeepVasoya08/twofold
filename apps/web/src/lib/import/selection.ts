import type { ImportItem } from './takeout';

/**
 * Picking part of an export to import: Takeout sorts photos by year, so the person picks
 * years until what they picked fits in the space they have left.
 */

/** A year of an export, or its photos that weren't in a year folder (`year` null). */
export interface YearGroup {
  year: number | null;
  count: number;
  /** About what its photos take up once stored. */
  bytes: number;
}

/** What a stored preview adds to each photo, about: a 640 px JPEG, sealed. */
export const PREVIEW_BYTES_ESTIMATE = 64 * 1024;

/** About what a photo takes up once stored: the original, sealed, and its preview. */
export function storedBytes(item: Pick<ImportItem, 'size'>): number {
  return item.size + PREVIEW_BYTES_ESTIMATE;
}

/** The export's years, newest first, with photos outside a year folder last. */
export function yearGroups(items: readonly ImportItem[]): YearGroup[] {
  const groups = new Map<number | null, YearGroup>();
  for (const item of items) {
    const group = groups.get(item.year) ?? { year: item.year, count: 0, bytes: 0 };
    group.count += 1;
    group.bytes += storedBytes(item);
    groups.set(item.year, group);
  }
  return [...groups.values()].sort((a, b) => (b.year ?? -1) - (a.year ?? -1));
}

/** The photos in the picked years. */
export function pickedItems(
  items: readonly ImportItem[],
  years: ReadonlySet<number | null>,
): ImportItem[] {
  return items.filter((item) => years.has(item.year));
}

/** Album titles the photos are in, in the order the export lists them. */
export function albumsOf(items: readonly ImportItem[], order: readonly string[]): string[] {
  const used = new Set(items.flatMap((item) => item.albums));
  return order.filter((title) => used.has(title));
}

/**
 * The newest years that fit in `free` bytes, as picked to start with. Years are added newest
 * first until the next one wouldn't fit.
 */
export function yearsThatFit(groups: readonly YearGroup[], free: number): Set<number | null> {
  const picked = new Set<number | null>();
  let total = 0;
  for (const group of groups) {
    if (total + group.bytes > free) break;
    total += group.bytes;
    picked.add(group.year);
  }
  return picked;
}
