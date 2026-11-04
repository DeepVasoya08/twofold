import type { Photo } from './model';

// Dates render in UTC until photos carry their own time zone, so labels never drift.
const monthFormat = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "March 2026". */
export function formatMonth(iso: string): string {
  return monthFormat.format(new Date(iso));
}

export interface MonthGroup {
  key: string;
  label: string;
  locations: string[];
  photos: Photo[];
}

export function sortNewestFirst(photos: readonly Photo[]): Photo[] {
  return [...photos].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/** Groups photos by calendar month, newest month and newest photo first. */
export function groupByMonth(photos: readonly Photo[]): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();
  for (const photo of sortNewestFirst(photos)) {
    const key = photo.takenAt.slice(0, 7);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: formatMonth(photo.takenAt), locations: [], photos: [] };
      groups.set(key, group);
    }
    group.photos.push(photo);
    if (photo.location && !group.locations.includes(photo.location)) {
      group.locations.push(photo.location);
    }
  }
  return [...groups.values()];
}
