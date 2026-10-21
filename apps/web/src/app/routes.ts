/** Every screen the app can show, parsed from the URL path. */
export type Route =
  | { name: 'welcome' }
  | { name: 'signup' }
  | { name: 'recovery-key' }
  | { name: 'login' }
  | { name: 'unlock' }
  | { name: 'recover' }
  | { name: 'gallery' }
  | { name: 'albums' }
  | { name: 'album'; albumId: string }
  | { name: 'favorites' }
  | { name: 'photo'; photoId: string }
  | { name: 'settings' }
  | { name: 'share' }
  /** Someone's invite link. The token only names the invite; it holds no key. */
  | { name: 'join'; token: string }
  | { name: 'not-found' };

export const paths = {
  welcome: '/',
  signup: '/signup',
  recoveryKey: '/signup/recovery-key',
  login: '/login',
  unlock: '/unlock',
  recover: '/recover',
  gallery: '/photos',
  albums: '/albums',
  album: (albumId: string) => `/albums/${encodeURIComponent(albumId)}`,
  favorites: '/favorites',
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
} as const;

/** An invite link token: 128 bits, unpadded base64url. */
const LINK_TOKEN = /^[A-Za-z0-9_-]{21}[AQgw]$/;

/**
 * Where to go after signing in, unlocking or signing up, from the `next` query parameter.
 * Only an invite link is accepted, so the parameter can't send anyone anywhere else.
 */
export function parseNext(search: string): string | null {
  const next = new URLSearchParams(search).get('next');
  return next !== null && matchRoute(next).name === 'join' ? next : null;
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
  '/signup': { name: 'signup' },
  '/signup/recovery-key': { name: 'recovery-key' },
  '/login': { name: 'login' },
  '/unlock': { name: 'unlock' },
  '/recover': { name: 'recover' },
  '/photos': { name: 'gallery' },
  '/albums': { name: 'albums' },
  '/favorites': { name: 'favorites' },
  '/settings': { name: 'settings' },
  '/settings/share': { name: 'share' },
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

  const album = /^\/albums\/([^/]+)$/.exec(path);
  const albumId = album?.[1] === undefined ? null : decodeSegment(album[1]);
  if (albumId) return { name: 'album', albumId };

  const join = /^\/join\/([^/]+)$/.exec(path);
  if (join?.[1] !== undefined && LINK_TOKEN.test(join[1])) return { name: 'join', token: join[1] };

  const photo = /^\/photos\/([^/]+)$/.exec(path);
  const photoId = photo?.[1] === undefined ? null : decodeSegment(photo[1]);
  if (photoId) return { name: 'photo', photoId };

  return { name: 'not-found' };
}

/** Which list a photo was opened from, so the viewer's next/previous stay inside it. */
export type PhotoContext =
  { kind: 'all' } | { kind: 'favorites' } | { kind: 'album'; albumId: string };

function formatContext(context: PhotoContext): string {
  return context.kind === 'album' ? `album:${encodeURIComponent(context.albumId)}` : context.kind;
}

export function parsePhotoContext(search: string): PhotoContext {
  const from = new URLSearchParams(search).get('from');
  if (from === 'favorites') return { kind: 'favorites' };
  if (from?.startsWith('album:')) {
    const albumId = decodeSegment(from.slice('album:'.length));
    if (albumId) return { kind: 'album', albumId };
  }
  return { kind: 'all' };
}
