import { landscapeDataUri, paletteNames } from './art';
import type { Palette } from './art';

/** Mock data for building the UI before the API and crypto are wired in. */

export interface Person {
  id: 'me' | 'contact';
  name: string;
  email: string;
}

export interface Photo {
  id: string;
  /**
   * Preview image URL: placeholder art (data URI) or an in-memory object URL of the decrypted
   * thumbnail. Empty until the thumbnail has been downloaded and decrypted.
   */
  src: string;
  /** In-memory object URL of the decrypted original, once the viewer has asked for it. */
  fullSrc?: string;
  width: number;
  height: number;
  /** ISO 8601 timestamp. */
  takenAt: string;
  location?: string;
  addedBy: Person['id'];
  /** The name of whoever added it, when that wasn't you. */
  addedByName?: string;
  favorite: boolean;
  albumIds: string[];
  /**
   * Set when the photo is someone else's: whose library it is (shared whole, or through one
   * album).
   */
  library?: string;
  /**
   * Set when the photo is here only because someone shared an album with you. You can view
   * and download it, but not change it, and it stays out of your timeline.
   */
  sharedAlbum?: boolean;
  /**
   * Set when the photo is someone else's and you can only view and download it: it came
   * through a shared album, or its library was shared with you view-only.
   */
  viewOnly?: boolean;
  /** Encrypted bytes it takes up on the server (both files), once it is stored. */
  size?: number;
  /**
   * Set while the photo is in Recently deleted: when it was deleted (ISO 8601). It is
   * deleted for good 30 days later.
   */
  deletedAt?: string;
}

export interface Album {
  id: string;
  title: string;
  coverPhotoId?: string;
  /** Set when the album is someone else's: whose library it is. */
  library?: string;
  /** Set when someone shared just this album with you. It can be viewed, not changed. */
  sharedAlbum?: boolean;
  /** Set when the album is someone else's and you can only view it. */
  viewOnly?: boolean;
  /** The people you've shared this album with, by name. */
  sharedWith?: string[];
  /** For an album shared with you: the record of it in your space, for leaving it. */
  joinedId?: string;
}

export const me: Person = { id: 'me', name: 'Deepu', email: 'deepu@example.com' };
/** Someone the main library is shared with. */
export const contact: Person = { id: 'contact', name: 'Mira', email: 'mira@example.com' };

export const sharedSince = '2025-11-02T12:00:00Z';

export const mockInviteCode = 'TWO-7KQ4-M9XD';

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
    albumId: 'celebrations',
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
    albumId: 'celebrations',
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

function buildPhotos(
  source: readonly Trip[],
  idPrefix: string,
  seedOffset: number,
  sharedBy: Person['id'] = 'me',
): Photo[] {
  const photos: Photo[] = [];
  let n = 0;
  for (const trip of source) {
    trip.days.forEach((day, index) => {
      n += 1;
      const size = sizes[(n * 7) % sizes.length] ?? [1200, 800];
      const palette =
        trip.palettes[index % trip.palettes.length] ??
        paletteNames[n % paletteNames.length] ??
        'dawn';
      const hour = String(9 + ((n * 5) % 11)).padStart(2, '0');
      photos.push({
        id: `${idPrefix}${String(n).padStart(3, '0')}`,
        src: landscapeDataUri({
          seed: (n + seedOffset) * 7919,
          palette,
          width: size[0],
          height: size[1],
        }),
        width: size[0],
        height: size[1],
        takenAt: `${trip.month}-${String(day).padStart(2, '0')}T${hour}:${String((n * 13) % 60).padStart(2, '0')}:00Z`,
        location: trip.location,
        ...(n % 3 === 0 && sharedBy === 'contact'
          ? { addedBy: 'contact' as const, addedByName: contact.name }
          : { addedBy: 'me' as const }),
        favorite: n % 5 === 1 || n % 7 === 0,
        albumIds: trip.albumId ? [trip.albumId] : [],
      });
    });
  }
  return photos;
}

export const initialPhotos: Photo[] = buildPhotos(trips, 'p', 0, 'contact');

export const initialAlbums: Album[] = [
  { id: 'kyoto', title: 'Kyoto in autumn' },
  { id: 'lisbon', title: 'Lisbon weekend' },
  { id: 'monsoon', title: 'Monsoon in Goa' },
  { id: 'celebrations', title: 'Celebrations' },
  { id: 'sundays', title: 'Slow Sundays' },
  { id: 'someday', title: 'Someday' },
];

const privateTrips: Trip[] = [
  {
    month: '2026-10',
    days: [13, 8, 2],
    location: 'Home',
    palettes: ['night', 'dusk'],
    albumId: 'keepsakes',
  },
  {
    month: '2026-08',
    days: [22, 21, 20, 19],
    location: 'Pondicherry, India',
    palettes: ['dusk', 'ocean', 'night'],
    albumId: 'just-me',
  },
  {
    month: '2026-04',
    days: [17, 5],
    location: 'Home',
    palettes: ['dawn', 'night'],
    albumId: 'keepsakes',
  },
  {
    month: '2026-01',
    days: [29, 12, 11],
    location: 'Coorg, India',
    palettes: ['forest', 'night', 'dusk'],
  },
];

/** The private space: a separate library that only the private password opens. */
export const initialPrivatePhotos: Photo[] = buildPhotos(privateTrips, 'x', 500);

export const initialPrivateAlbums: Album[] = [
  { id: 'keepsakes', title: 'Keepsakes' },
  { id: 'just-me', title: 'Just for me' },
];
