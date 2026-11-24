import { formatBytes } from '@arcafold/core/format-bytes';
import type { Album, Photo } from '@arcafold/core/library/model';

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

/** The viewer's heading for a photo: "Sat, Nov 22, 2026". */
export function viewerDay(iso: string): string {
  return dayFormat.format(new Date(iso));
}

/** The line under it: "4:12 PM · 12 of 48". */
export function viewerPlace(iso: string, index: number, total: number): string {
  return `${timeFormat.format(new Date(iso))} · ${String(index + 1)} of ${String(total)}`;
}

/** One fact in the Details sheet. */
export interface Fact {
  label: string;
  value: string;
}

/** What the Details sheet says about a photo: when, how big, where, and whose. */
export function photoFacts(photo: Photo): Fact[] {
  const facts: Fact[] = [
    {
      label: 'Taken',
      value: `${viewerDay(photo.takenAt)}, ${timeFormat.format(new Date(photo.takenAt))}`,
    },
  ];
  if (photo.width > 0 && photo.height > 0) {
    facts.push({ label: 'Size', value: `${String(photo.width)} × ${String(photo.height)}` });
  }
  if (photo.size !== undefined) facts.push({ label: 'Stored', value: formatBytes(photo.size) });
  if (photo.location) facts.push({ label: 'Place', value: photo.location });
  facts.push({
    label: 'Added by',
    value: photo.library ? (photo.addedByName ?? photo.library) : 'You',
  });
  return facts;
}

/** The names of the albums a photo is in, as the Details sheet lists them. */
export function photoAlbums(photo: Photo, albums: readonly Album[]): string[] {
  const inIt = new Set(photo.albumIds);
  return albums.filter((album) => inIt.has(album.id)).map((album) => album.title);
}

export type BarAction = 'share' | 'save' | 'album' | 'similar' | 'move' | 'delete';

/**
 * The viewer's bottom bar, in order: what can be done with the photo in view. Rarer actions
 * (taking it out of an album, saying it isn't someone) are in the Details sheet.
 */
export function barActions(can: {
  share?: boolean;
  save: boolean;
  file: boolean;
  similar: boolean;
  move: boolean;
}): BarAction[] {
  const actions: BarAction[] = [];
  if (can.share === true) actions.push('share');
  if (can.save) actions.push('save');
  if (can.file) actions.push('album');
  if (can.similar) actions.push('similar');
  if (can.move) actions.push('move');
  if (can.file) actions.push('delete');
  return actions;
}
