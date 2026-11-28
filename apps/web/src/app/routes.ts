import { idNamed, nameFor } from './addresses';

/**
 * Every screen the app can show, parsed from the URL path. Addresses name photos, albums,
 * files, folders and people by random names that last until Arcafold locks (see
 * `addresses.ts`), never by their ids; a route holds the id the name stands for.
 */
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
  /** Files that aren't photos: PDFs, documents and the rest. */
  | { name: 'files' }
  /** One folder in Files. */
  | { name: 'folder'; folderId: string }
  /** One file, shown inside the app where it can be (PDFs, text, Word). */
  | { name: 'file'; fileId: string }
  /** Photos deleted in the last 30 days, which can still be restored. */
  | { name: 'trash' }
  /** The query is never in the URL, so it can't end up in the browser's history. */
  | { name: 'search' }
  | { name: 'people' }
  /** One person, or a group of faces nobody has named yet. */
  | { name: 'person'; groupId: string }
  | { name: 'photo'; photoId: string }
  | { name: 'settings' }
  /** Bringing photos in from a Google Photos export. */
  | { name: 'import' }
  /** Inviting someone to the library, or to one album, folder or file (`albumId`). */
  | { name: 'share'; albumId: string | null }
  /** Someone's invite link. The token only names the invite; it holds no key. */
  | { name: 'join'; token: string }
  /** Typing in an invite code someone sent. */
  | { name: 'join-code' }
  /** A hidden page that measures how fast this device runs Smart search. */
  | { name: 'speed-test' }
  /**
   * An address from before Arcafold last locked, whose name stands for nothing now: it goes
   * on to the list it was in (`to`), the same wherever it came from.
   */
  | { name: 'gone'; to: string }
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
  album: (albumId: string) => `/albums/${nameFor(albumId)}`,
  smartAlbum: (albumId: string) => `/albums/smart/${nameFor(albumId)}`,
  favorites: '/favorites',
  files: '/files',
  folder: (folderId: string) => `/files/folder/${nameFor(folderId)}`,
  /**
   * A file, opened from an album (by its id) or a folder when `from` says so, so its back
   * link returns there.
   */
  file: (fileId: string, from?: string | PhotoContext) => {
    const context: PhotoContext | undefined =
      typeof from === 'string' ? { kind: 'album', albumId: from } : from;
    const query = context && context.kind !== 'all' ? `?from=${formatContext(context)}` : '';
    return `/files/${nameFor(fileId)}${query}`;
  },
  trash: '/recently-deleted',
  search: '/search',
  people: '/people',
  person: (groupId: string) => `/people/${nameFor(groupId)}`,
  photo: (photoId: string, from?: PhotoContext) => {
    const base = `/photos/${nameFor(photoId)}`;
    return from && from.kind !== 'all' ? `${base}?from=${formatContext(from)}` : base;
  },
  settings: '/settings',
  import: '/settings/import',
  /** The import screen, showing Apple Photos' steps first. */
  importFrom: (from: 'apple') => `/settings/import?from=${from}`,
  share: '/settings/share',
  /** Inviting someone to one album rather than the whole library. */
  shareAlbum: (albumId: string) => `/settings/share/${nameFor(albumId)}`,
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
  '/files': { name: 'files' },
  '/recently-deleted': { name: 'trash' },
  '/search': { name: 'search' },
  '/people': { name: 'people' },
  '/settings': { name: 'settings' },
  '/settings/import': { name: 'import' },
  '/settings/share': { name: 'share', albumId: null },
  '/join': { name: 'join-code' },
  '/lab/speed': { name: 'speed-test' },
};

/** What every name in an address looks like (see `addresses.ts`). */
const NAME = /^[A-Za-z0-9_-]{22}$/;

/** The id a name in an address or query stands for, or null if it names nothing now. */
function namedId(segment: string | undefined): string | null {
  return segment !== undefined && NAME.test(segment) ? idNamed(segment) : null;
}

/** Addresses that end in a name: where each leads, and the list it goes back to if stale. */
const namedRoutes: readonly { pattern: RegExp; route: (id: string) => Route; list: string }[] = [
  {
    pattern: /^\/albums\/smart\/([^/]+)$/,
    route: (albumId) => ({ name: 'smart-album', albumId }),
    list: paths.albums,
  },
  {
    pattern: /^\/albums\/([^/]+)$/,
    route: (albumId) => ({ name: 'album', albumId }),
    list: paths.albums,
  },
  {
    pattern: /^\/people\/([^/]+)$/,
    route: (groupId) => ({ name: 'person', groupId }),
    list: paths.people,
  },
  {
    pattern: /^\/files\/folder\/([^/]+)$/,
    route: (folderId) => ({ name: 'folder', folderId }),
    list: paths.files,
  },
  {
    pattern: /^\/files\/([^/]+)$/,
    route: (fileId) => ({ name: 'file', fileId }),
    list: paths.files,
  },
  {
    pattern: /^\/photos\/([^/]+)$/,
    route: (photoId) => ({ name: 'photo', photoId }),
    list: paths.gallery,
  },
  {
    pattern: /^\/settings\/share\/([^/]+)$/,
    route: (albumId) => ({ name: 'share', albumId }),
    list: paths.albums,
  },
];

export function matchRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const staticRoute = staticRoutes[path];
  if (staticRoute) return staticRoute;

  const join = /^\/join\/([^/]+)$/.exec(path);
  if (join?.[1] !== undefined && LINK_TOKEN.test(join[1])) return { name: 'join', token: join[1] };

  for (const { pattern, route, list } of namedRoutes) {
    const segment = pattern.exec(path)?.[1];
    if (segment === undefined) continue;
    // Anything but one of the app's own names was never an address it made.
    if (!NAME.test(segment)) return { name: 'not-found' };
    const id = namedId(segment);
    return id === null ? { name: 'gone', to: list } : route(id);
  }
  return { name: 'not-found' };
}

/** Which list a photo was opened from, so the viewer's next/previous stay inside it. */
export type PhotoContext =
  | { kind: 'all' }
  | { kind: 'favorites' }
  /** Photos that look like documents, from Files. */
  | { kind: 'documents' }
  /** The last search's results, held in memory: the URL only says "search". */
  | { kind: 'search' }
  | { kind: 'album'; albumId: string }
  /** A folder in Files. */
  | { kind: 'folder'; folderId: string }
  /** A smart album's photos, found again on this device: the URL only names the album. */
  | { kind: 'smart'; albumId: string }
  | { kind: 'person'; groupId: string };

/** The `from` of an address: the list's kind, and its name where it is one album or person. */
function formatContext(context: PhotoContext): string {
  switch (context.kind) {
    case 'album':
      return `album:${nameFor(context.albumId)}`;
    case 'folder':
      return `folder:${nameFor(context.folderId)}`;
    case 'smart':
      return `smart:${nameFor(context.albumId)}`;
    case 'person':
      return `person:${nameFor(context.groupId)}`;
    default:
      return context.kind;
  }
}

/** Which list a photo was opened from. A name from before Arcafold last locked means none. */
export function parsePhotoContext(search: string): PhotoContext {
  const from = new URLSearchParams(search).get('from');
  if (from === 'favorites') return { kind: 'favorites' };
  if (from === 'search') return { kind: 'search' };
  if (from === 'documents') return { kind: 'documents' };
  const [kind, name] = from?.split(':') ?? [];
  const id = namedId(name);
  if (id === null) return { kind: 'all' };
  switch (kind) {
    case 'album':
      return { kind: 'album', albumId: id };
    case 'folder':
      return { kind: 'folder', folderId: id };
    case 'smart':
      return { kind: 'smart', albumId: id };
    case 'person':
      return { kind: 'person', groupId: id };
    default:
      return { kind: 'all' };
  }
}
