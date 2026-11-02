import { photoTypeOf } from './takeout';
import type { ImportItem } from './takeout';

/**
 * Brings photos over from Google Photos with Google's Photos Picker API: the person picks
 * photos in Google Photos itself, and this browser downloads each one and encrypts it before
 * it goes anywhere. Twofold's server never sees the photos or the Google sign-in; the access
 * token lives in memory only, for as long as the import runs.
 *
 * Google gives each picked photo's file name, media type and creation time, but not its
 * albums, and at most 2,000 photos per pick.
 */

export const PICKER_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const API = 'https://photospicker.googleapis.com/v1';

/** Google's own cap on photos picked at once. */
export const PICKER_MAX_ITEMS = 2000;
/** Picked photos' sizes aren't known before they're downloaded: this is a typical one. */
export const PICKED_PHOTO_SIZE_ESTIMATE = 4 * 1024 * 1024;

export class PickerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PickerError';
  }
}

const SIGNED_OUT = 'Your Google sign-in has ended. Connect Google Photos again to carry on.';
const UNREACHABLE = 'Google Photos couldn’t be reached. Check your connection and try again.';

export interface PickerSession {
  id: string;
  /** Where the person picks photos: Google Photos, on the web or in its app. */
  pickerUri: string;
  /** Whether the person has finished picking. */
  mediaItemsSet: boolean;
  pollIntervalMs: number;
  /** How long the session waits for picks before Google ends it. */
  timeoutMs: number;
}

export interface PickedPhoto {
  id: string;
  filename: string;
  mimeType: string;
  /** When it was taken, in ms, where Google says. */
  createTime?: number;
  baseUrl: string;
}

export interface PickedItems {
  photos: PickedPhoto[];
  /** Videos picked, which Twofold can't store yet. */
  videos: number;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** "5s", "1.5s" or "3600s", as Google writes durations, in ms. */
export function parseDuration(value: unknown, fallbackMs: number): number {
  if (typeof value !== 'string') return fallbackMs;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
  return match ? Math.round(Number(match[1]) * 1000) : fallbackMs;
}

/**
 * Reads a session. Once picking is done, Google leaves `pickerUri` and `pollingConfig` out, so
 * when checking on a session already started (`previous`), those come from it instead.
 */
function parseSession(json: unknown, previous?: PickerSession): PickerSession {
  if (!isRecord(json) || typeof json.id !== 'string') throw new PickerError(UNREACHABLE);
  const pickerUri = typeof json.pickerUri === 'string' ? json.pickerUri : previous?.pickerUri;
  if (!pickerUri?.startsWith('https://')) {
    throw new PickerError(UNREACHABLE);
  }
  const polling = isRecord(json.pollingConfig) ? json.pollingConfig : {};
  return {
    id: json.id,
    pickerUri,
    mediaItemsSet: json.mediaItemsSet === true,
    // Never faster than once a second, whatever the session says.
    pollIntervalMs: Math.max(
      1000,
      parseDuration(polling.pollInterval, previous?.pollIntervalMs ?? 3000),
    ),
    timeoutMs: parseDuration(polling.timeoutIn, previous?.timeoutMs ?? 30 * 60_000),
  };
}

function parseItem(json: unknown): PickedPhoto | 'video' | null {
  if (!isRecord(json) || typeof json.id !== 'string' || !isRecord(json.mediaFile)) return null;
  if (json.type === 'VIDEO') return 'video';
  const { baseUrl, mimeType, filename } = json.mediaFile;
  if (typeof baseUrl !== 'string' || !baseUrl.startsWith('https://')) return null;
  if (typeof mimeType !== 'string' || !mimeType.startsWith('image/')) return null;
  const photo: PickedPhoto = {
    id: json.id,
    filename: typeof filename === 'string' && filename.trim() !== '' ? filename : `${json.id}.jpg`,
    mimeType,
    baseUrl,
  };
  const created = typeof json.createTime === 'string' ? Date.parse(json.createTime) : NaN;
  if (Number.isFinite(created)) photo.createTime = created;
  return photo;
}

/** The Picker API, as the signed-in person: `token` is their Google access token. */
export function pickerClient(token: string, fetcher: Fetcher = fetch.bind(globalThis)) {
  const call = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetcher(`${API}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
    } catch {
      throw new PickerError(UNREACHABLE);
    }
    if (response.status === 401 || response.status === 403) throw new PickerError(SIGNED_OUT);
    if (!response.ok) throw new PickerError(UNREACHABLE);
    return response.status === 204 ? null : ((await response.json()) as unknown);
  };

  return {
    /** Starts a pick. */
    createSession: async (): Promise<PickerSession> =>
      parseSession(
        await call('/sessions', {
          method: 'POST',
          body: JSON.stringify({ pickingConfig: { maxItemCount: String(PICKER_MAX_ITEMS) } }),
        }),
      ),

    /** Checks on a session started earlier. */
    getSession: async (session: PickerSession): Promise<PickerSession> =>
      parseSession(await call(`/sessions/${encodeURIComponent(session.id)}`), session),

    /** Everything picked in a session, a page at a time. */
    listPicked: async (sessionId: string): Promise<PickedItems> => {
      const picked: PickedItems = { photos: [], videos: 0 };
      let pageToken = '';
      do {
        const query = new URLSearchParams({ sessionId, pageSize: '100' });
        if (pageToken) query.set('pageToken', pageToken);
        const page = await call(`/mediaItems?${query.toString()}`);
        if (!isRecord(page)) throw new PickerError(UNREACHABLE);
        const items = Array.isArray(page.mediaItems) ? (page.mediaItems as unknown[]) : [];
        for (const item of items) {
          const parsed = parseItem(item);
          if (parsed === 'video') picked.videos += 1;
          else if (parsed) picked.photos.push(parsed);
        }
        pageToken = typeof page.nextPageToken === 'string' ? page.nextPageToken : '';
      } while (pageToken);
      return picked;
    },

    /** Downloads a picked photo's original, straight from Google to this browser. */
    download: async (photo: PickedPhoto): Promise<Uint8Array<ArrayBuffer>> => {
      let response: Response;
      try {
        // "=d" asks for the original file rather than a resized copy.
        response = await fetcher(`${photo.baseUrl}=d`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        throw new PickerError(UNREACHABLE);
      }
      if (response.status === 401 || response.status === 403) throw new PickerError(SIGNED_OUT);
      if (!response.ok) throw new PickerError(UNREACHABLE);
      return new Uint8Array(await response.arrayBuffer());
    },

    /** Ends a session once its photos are in, as Google asks. */
    deleteSession: async (id: string): Promise<void> => {
      await call(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}

export type PickerClient = ReturnType<typeof pickerClient>;

/**
 * Waits for the person to finish picking, asking Google as often as it says to. Throws
 * PickerError if the session runs out first, and stops quietly (with null) when `signal`
 * aborts.
 */
export async function waitForPicks(
  client: Pick<PickerClient, 'getSession'>,
  session: PickerSession,
  signal: AbortSignal,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
): Promise<PickerSession | null> {
  // A function, so each check reads the signal afresh after an await.
  const stopped = () => signal.aborted;
  let current = session;
  let waited = 0;
  while (!current.mediaItemsSet) {
    if (waited >= session.timeoutMs) {
      throw new PickerError('Picking took too long. Connect Google Photos again to start over.');
    }
    await sleep(current.pollIntervalMs);
    if (stopped()) return null;
    waited += current.pollIntervalMs;
    current = await client.getSession(current);
    if (stopped()) return null;
  }
  return current;
}

/** Picked photos as import items, read from Google when the import gets to them. */
export function pickedItems(
  photos: readonly PickedPhoto[],
  download: PickerClient['download'],
): ImportItem[] {
  return photos.map((photo) => {
    const item: ImportItem = {
      name: photo.filename,
      size: PICKED_PHOTO_SIZE_ESTIMATE,
      // Google's media type, unless the name says better (HEIC is sometimes image/heif).
      type: photoTypeOf(photo.filename) ?? photo.mimeType,
      year: photo.createTime === undefined ? null : new Date(photo.createTime).getUTCFullYear(),
      albums: [],
      source: {
        path: photo.filename,
        size: PICKED_PHOTO_SIZE_ESTIMATE,
        read: () => download(photo),
      },
    };
    if (photo.createTime !== undefined) item.takenAt = photo.createTime;
    return item;
  });
}
