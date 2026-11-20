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
  return gridRows(timelinePhotos(photos), columns);
}

/** Any set of photos (an album's, say) as grid rows by month, without leaving any out. */
export function gridRows(photos: readonly Photo[], columns = COLUMNS): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const month of groupByMonth(photos)) {
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

// Dates show in UTC, as on the web, until photos carry their own time zone.
const dayFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const timeFormat = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
});

/** "Tue, Nov 4, 2026 · 9:41 AM": when a photo was taken, for the viewer. */
export function formatTaken(iso: string): string {
  const date = new Date(iso);
  return `${dayFormat.format(date)} · ${timeFormat.format(date)}`;
}

/** The timeline's photos in the order the grid shows them, for swiping through. */
export function timelineOrder(photos: readonly Photo[], rows: readonly TimelineRow[]): Photo[] {
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  return photosInRows(rows).flatMap((photoId) => {
    const photo = byId.get(photoId);
    return photo ? [photo] : [];
  });
}

/** Ranked results as grid rows, four across, with no month headings. */
export function resultRows(photoIds: readonly string[], columns = COLUMNS): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (let start = 0; start < photoIds.length; start += columns) {
    const ids = photoIds.slice(start, start + columns);
    rows.push({ kind: 'tiles', key: `r${String(start)}`, photoIds: ids });
  }
  return rows;
}
