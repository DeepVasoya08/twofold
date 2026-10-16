import type { Photo } from '../mock/data';

// Dates render in UTC until photos carry their own time zone, so labels never drift.
const monthFormat = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const dayFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const shortDayFormat = new Intl.DateTimeFormat('en-US', {
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

export function formatMonth(iso: string): string {
  return monthFormat.format(new Date(iso));
}

export function formatDay(iso: string): string {
  return dayFormat.format(new Date(iso));
}

export function formatShortDay(iso: string): string {
  return shortDayFormat.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

export function pluralize(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

/** "Jul 6 – 21, 2026", "Nov 2, 2025 – Feb 14, 2026", or a single day. */
export function formatDateRange(isoDates: string[]): string | null {
  if (isoDates.length === 0) return null;
  const sorted = [...isoDates].sort();
  const first = sorted[0] ?? '';
  const last = sorted[sorted.length - 1] ?? first;
  const a = new Date(first);
  const b = new Date(last);
  if (shortDayFormat.format(a) === shortDayFormat.format(b)) return shortDayFormat.format(a);
  if (a.getUTCFullYear() === b.getUTCFullYear()) {
    const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
    const sameMonth = a.getUTCMonth() === b.getUTCMonth();
    const end = sameMonth ? String(b.getUTCDate()) : `${month.format(b)} ${String(b.getUTCDate())}`;
    return `${month.format(a)} ${String(a.getUTCDate())} – ${end}, ${String(b.getUTCFullYear())}`;
  }
  return `${shortDayFormat.format(a)} – ${shortDayFormat.format(b)}`;
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

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}
