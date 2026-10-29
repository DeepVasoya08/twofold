/** Every screen the app can show, parsed from the URL path. */
export type Route =
  | { name: 'welcome' }
  | { name: 'privacy' }
  | { name: 'terms' }
  | { name: 'signup' }
  | { name: 'recovery-key' }
  | { name: 'login' }
  | { name: 'unlock' }
  | { name: 'recover' }
  | { name: 'gallery' }
  | { name: 'albums' }
  | { name: 'album'; albumId: string }
  /** A search saved as an album. */
  | { name: 'smart-album'; albumId: string }
  | { name: 'favorites' }
  /** Photos deleted in the last 30 days, which can still be restored. */
  | { name: 'trash' }
  /** The query is never in the URL, so it can't end up in the browser's history. */
  | { name: 'search' }
  | { name: 'people' }
  /** One person, or a group of faces nobody has named yet. */
  | { name: 'person'; groupId: string }
  | { name: 'photo'; photoId: string }
  | { name: 'settings' }
  | { name: 'share' }
  /** Someone's invite link. The token only names the invite; it holds no key. */
  | { name: 'join'; token: string }
  /** Typing in an invite code someone sent. */
  | { name: 'join-code' }
  /** A hidden page that measures how fast this device runs Smart search. */
  | { name: 'speed-test' }
  | { name: 'not-found' };

export const paths = {
  welcome: '/',
  privacy: '/privacy',
  terms: '/terms',
  signup: '/signup',
  recoveryKey: '/signup/recovery-key',
  login: '/login',
  unlock: '/unlock',
  recover: '/recover',
  gallery: '/photos',
  albums: '/albums',
  album: (albumId: string) => `/albums/${encodeURIComponent(albumId)}`,
  smartAlbum: (albumId: string) => `/albums/smart/${encodeURIComponent(albumId)}`,
  favorites: '/favorites',
  trash: '/recently-deleted',
  search: '/search',
  people: '/people',
  person: (groupId: string) => `/people/${encodeURIComponent(groupId)}`,
  photo: (photoId: string, from?: PhotoContext) => {
    const base = `/photos/${encodeURIComponent(photoId)}`;
    return from && from.kind !== 'all' ? `${base}?from=${formatContext(from)}` : base;
  },
  settings: '/settings',
  share: '/settings/share',
  /** Inviting someone to one album rather than the whole library. */
  shareAlbum: (albumId: string) => `/settings/share?album=${encodeURIComponent(albumId)}`,
  /** An invite link's path. */
  join: (token: string) => `/join/${token}`,
  /** Where an invite code is typed in. */
  joinCode: '/join',
  speedTest: '/lab/speed',
} as const;

/** An invite link token: 128 bits, unpadded base64url. */
const LINK_TOKEN = /^[A-Za-z0-9_-]{21}[AQgw]$/;

/**
 * Where to go after signing in, unlocking or signing up, from the `next` query parameter.
 * Only an invite link or the code screen is accepted, so the parameter can't send anyone
 * anywhere else.
 */
export function parseNext(search: string): string | null {
  const next = new URLSearchParams(search).get('next');
  if (next === null) return null;
  const route = matchRoute(next).name;
  return route === 'join' || route === 'join-code' ? next : null;
}

/** `path` with a `next` parameter to come back to afterwards, if there is one. */
export function withNext(path: string, next: string | null): string {
  return next === null ? path : `${path}?next=${encodeURIComponent(next)}`;
}

/** The album a share link names, if it's for one album. */
export function parseShareAlbum(search: string): string | null {
  const album = new URLSearchParams(search).get('album');
  return album === null ? null : decodeSegment(album);
}

const staticRoutes: Record<string, Route> = {
  '/': { name: 'welcome' },
  '/privacy': { name: 'privacy' },
  '/terms': { name: 'terms' },
  '/signup': { name: 'signup' },
  '/signup/recovery-key': { name: 'recovery-key' },
  '/login': { name: 'login' },
  '/unlock': { name: 'unlock' },
  '/recover': { name: 'recover' },
  '/photos': { name: 'gallery' },
  '/albums': { name: 'albums' },
  '/favorites': { name: 'favorites' },
  '/recently-deleted': { name: 'trash' },
  '/search': { name: 'search' },
  '/people': { name: 'people' },
  '/settings': { name: 'settings' },
  '/settings/share': { name: 'share' },
  '/join': { name: 'join-code' },
  '/lab/speed': { name: 'speed-test' },
};

function decodeSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded.length > 0 && !decoded.includes('/') ? decoded : null;
  } catch {
    return null;
  }
}

export function matchRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const staticRoute = staticRoutes[path];
  if (staticRoute) return staticRoute;

  const smart = /^\/albums\/smart\/([^/]+)$/.exec(path);
  const smartId = smart?.[1] === undefined ? null : decodeSegment(smart[1]);
  if (smartId) return { name: 'smart-album', albumId: smartId };

  const album = /^\/albums\/([^/]+)$/.exec(path);
  const albumId = album?.[1] === undefined ? null : decodeSegment(album[1]);
  if (albumId) return { name: 'album', albumId };

  const person = /^\/people\/([^/]+)$/.exec(path);
  const groupId = person?.[1] === undefined ? null : decodeSegment(person[1]);
  if (groupId) return { name: 'person', groupId };

  const join = /^\/join\/([^/]+)$/.exec(path);
  if (join?.[1] !== undefined && LINK_TOKEN.test(join[1])) return { name: 'join', token: join[1] };

  const photo = /^\/photos\/([^/]+)$/.exec(path);
  const photoId = photo?.[1] === undefined ? null : decodeSegment(photo[1]);
  if (photoId) return { name: 'photo', photoId };

  return { name: 'not-found' };
}

/** Which list a photo was opened from, so the viewer's next/previous stay inside it. */
export type PhotoContext =
  | { kind: 'all' }
  | { kind: 'favorites' }
  /** The last search's results, held in memory: the URL only says "search". */
  | { kind: 'search' }
  | { kind: 'album'; albumId: string }
  /** A smart album's photos, found again on this device: the URL only names the album. */
  | { kind: 'smart'; albumId: string }
  | { kind: 'person'; groupId: string };

function formatContext(context: PhotoContext): string {
  switch (context.kind) {
    case 'album':
      return `album:${encodeURIComponent(context.albumId)}`;
    case 'smart':
      return `smart:${encodeURIComponent(context.albumId)}`;
    case 'person':
      return `person:${encodeURIComponent(context.groupId)}`;
    default:
      return context.kind;
  }
}

export function parsePhotoContext(search: string): PhotoContext {
  const from = new URLSearchParams(search).get('from');
  if (from === 'favorites') return { kind: 'favorites' };
  if (from === 'search') return { kind: 'search' };
  if (from?.startsWith('album:')) {
    const albumId = decodeSegment(from.slice('album:'.length));
    if (albumId) return { kind: 'album', albumId };
  }
  if (from?.startsWith('smart:')) {
    const albumId = decodeSegment(from.slice('smart:'.length));
    if (albumId) return { kind: 'smart', albumId };
  }
  if (from?.startsWith('person:')) {
    const groupId = decodeSegment(from.slice('person:'.length));
    if (groupId) return { kind: 'person', groupId };
  }
  return { kind: 'all' };
}
