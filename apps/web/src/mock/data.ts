import { landscapeDataUri, paletteNames } from './art';
import type { Palette } from './art';

/** Mock data for building the UI before the API and crypto are wired in. */

export interface Person {
  id: 'me' | 'partner';
  name: string;
  email: string;
}

export interface Photo {
  id: string;
  /** Image URL: placeholder art (data URI) or an in-memory object URL for local uploads. */
  src: string;
  width: number;
  height: number;
  /** ISO 8601 timestamp. */
  takenAt: string;
  location?: string;
  addedBy: Person['id'];
  favorite: boolean;
  albumIds: string[];
}

export interface Album {
  id: string;
  title: string;
  coverPhotoId?: string;
}

export const me: Person = { id: 'me', name: 'Deepu', email: 'deepu@example.com' };
export const partner: Person = { id: 'partner', name: 'Mira', email: 'mira@example.com' };

export const pairedSince = '2025-11-02T12:00:00Z';

/** Placeholder only. Real recovery keys will come from packages/crypto. */
export const mockRecoveryKey = [
  'MAPLE',
  'RIVER',
  'LANTERN',
  'ORBIT',
  'VELVET',
  'HARBOR',
  'TULIP',
  'EMBER',
  'CANYON',
  'SPARROW',
  'QUARTZ',
  'MEADOW',
];

export const mockInviteCode = 'TWO-7KQ4-M9XD';

export interface Device {
  id: string;
  name: string;
  kind: 'laptop' | 'phone';
  lastActive: string;
  current: boolean;
}

export const devices: Device[] = [
  {
    id: 'd1',
    name: 'Chrome on MacBook Air',
    kind: 'laptop',
    lastActive: '2026-10-16T06:00:00Z',
    current: true,
  },
  {
    id: 'd2',
    name: 'Safari on iPhone 16',
    kind: 'phone',
    lastActive: '2026-10-15T21:40:00Z',
    current: false,
  },
];

interface Trip {
  month: string;
  days: number[];
  location: string;
  palettes: Palette[];
  albumId?: string;
}

const trips: Trip[] = [
  {
    month: '2026-10',
    days: [14, 12, 11, 9, 4],
    location: 'Home',
    palettes: ['golden', 'dawn'],
    albumId: 'sundays',
  },
  {
    month: '2026-09',
    days: [27, 26, 26, 25, 24, 24, 23],
    location: 'Kyoto, Japan',
    palettes: ['dusk', 'forest', 'night'],
    albumId: 'kyoto',
  },
  {
    month: '2026-08',
    days: [18, 16, 9, 3],
    location: 'Goa, India',
    palettes: ['ocean', 'sunset'],
    albumId: 'monsoon',
  },
  {
    month: '2026-07',
    days: [21, 20, 19, 6],
    location: 'Lisbon, Portugal',
    palettes: ['golden', 'ocean', 'sunset'],
    albumId: 'lisbon',
  },
  {
    month: '2026-05',
    days: [30, 18, 11],
    location: 'Home',
    palettes: ['dawn', 'forest'],
    albumId: 'sundays',
  },
  {
    month: '2026-03',
    days: [22, 21, 8],
    location: 'Jaipur, India',
    palettes: ['desert', 'golden'],
  },
  {
    month: '2026-02',
    days: [14, 14, 13],
    location: 'Udaipur, India',
    palettes: ['sunset', 'dusk'],
    albumId: 'first-year',
  },
  {
    month: '2025-12',
    days: [31, 25, 24, 20],
    location: 'Manali, India',
    palettes: ['night', 'dawn', 'forest'],
  },
  {
    month: '2025-11',
    days: [16, 9, 2, 2],
    location: 'Mumbai, India',
    palettes: ['ocean', 'dusk', 'sunset'],
    albumId: 'first-year',
  },
];

const sizes: [number, number][] = [
  [1200, 800],
  [800, 1200],
  [1200, 900],
  [1000, 1000],
  [1280, 720],
  [900, 1200],
];

function buildPhotos(): Photo[] {
  const photos: Photo[] = [];
  let n = 0;
  for (const trip of trips) {
    trip.days.forEach((day, index) => {
      n += 1;
      const size = sizes[(n * 7) % sizes.length] ?? [1200, 800];
      const palette =
        trip.palettes[index % trip.palettes.length] ??
        paletteNames[n % paletteNames.length] ??
        'dawn';
      const hour = String(9 + ((n * 5) % 11)).padStart(2, '0');
      photos.push({
        id: `p${String(n).padStart(3, '0')}`,
        src: landscapeDataUri({ seed: n * 7919, palette, width: size[0], height: size[1] }),
        width: size[0],
        height: size[1],
        takenAt: `${trip.month}-${String(day).padStart(2, '0')}T${hour}:${String((n * 13) % 60).padStart(2, '0')}:00Z`,
        location: trip.location,
        addedBy: n % 3 === 0 ? 'partner' : 'me',
        favorite: n % 5 === 1 || n % 7 === 0,
        albumIds: trip.albumId ? [trip.albumId] : [],
      });
    });
  }
  return photos;
}

export const initialPhotos: Photo[] = buildPhotos();

export const initialAlbums: Album[] = [
  { id: 'kyoto', title: 'Kyoto in autumn' },
  { id: 'lisbon', title: 'Lisbon weekend' },
  { id: 'monsoon', title: 'Monsoon in Goa' },
  { id: 'first-year', title: 'Our first year' },
  { id: 'sundays', title: 'Slow Sundays' },
  { id: 'someday', title: 'Someday' },
];
