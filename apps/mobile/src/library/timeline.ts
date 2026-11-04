import type { Photo } from '@arcafold/core/library/model';
import { groupByMonth } from '@arcafold/core/library/months';

/** Tiles across the timeline on a phone held upright. */
export const COLUMNS = 4;

/**
 * What the timeline shows: your photos, not files (they live in Files), not ones only
 * shared with you through an album, and not ones in Recently deleted.
 */
export function timelinePhotos(photos: readonly Photo[]): Photo[] {
  return photos.filter(
    (photo) => !photo.file && !photo.sharedAlbum && photo.deletedAt === undefined,
  );
}

export type TimelineRow =
  | { kind: 'month'; key: string; label: string; count: number }
  | { kind: 'tiles'; key: string; photoIds: string[] };

/**
 * The timeline as list rows: each month's heading, then its photos `columns` to a row,
 * newest first. One list row per grid row keeps the list fast with thousands of photos.
 */
export function timelineRows(photos: readonly Photo[], columns = COLUMNS): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const month of groupByMonth(timelinePhotos(photos))) {
    rows.push({ kind: 'month', key: month.key, label: month.label, count: month.photos.length });
    for (let start = 0; start < month.photos.length; start += columns) {
      const photoIds = month.photos.slice(start, start + columns).map((photo) => photo.id);
      rows.push({ kind: 'tiles', key: `${month.key}/${String(start)}`, photoIds });
    }
  }
  return rows;
}

/** The photos in rows the list says are on screen, to load their previews first. */
export function photosInRows(rows: readonly (TimelineRow | undefined)[]): string[] {
  return rows.flatMap((row) => (row?.kind === 'tiles' ? row.photoIds : []));
}
