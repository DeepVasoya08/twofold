/**
 * Pieces of the backup test that don't touch the phone, so they can be tested in Node.
 *
 * The photo record format copies apps/web/src/app/space-store.ts (PhotoMeta and
 * encodePhotoMeta) so the web app shows these photos like any other. Phase 1 moves that
 * format into a shared package; until then the two must be kept the same by hand.
 */

/** Records are padded to at least this many bytes, like the web app's PHOTO_RECORD_MIN. */
export const PHOTO_RECORD_MIN = 1000;

export interface PhotoMeta {
  v: 1;
  key: string;
  type: string;
  width: number;
  height: number;
  takenAt: string;
  favorite: boolean;
  albumIds: string[];
  fp?: string;
}

export function encodePhotoMeta(meta: PhotoMeta): Uint8Array {
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const bytes = encode({ ...meta, pad: '' });
  const missing = PHOTO_RECORD_MIN - bytes.length;
  return missing > 0 ? encode({ ...meta, pad: ' '.repeat(missing) }) : bytes;
}

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
};

/** The photo type for a gallery file name, or null for a format Arcafold doesn't store. */
export function photoTypeOf(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return null;
  return TYPES[filename.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * Runs `work` on every item, at most `limit` at a time, in order of starting. Uses only
 * promises, never timers: React Native pauses timers while the app is in the background.
 */
export async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      await work(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/** One stretch of time the app spent in a state (active, background, inactive). */
export interface StateSpan {
  state: string;
  from: number;
  to: number;
}

/** How many photos finished while the app was not on screen. */
export function finishedInBackground(finishedAt: readonly number[], spans: readonly StateSpan[]) {
  return finishedAt.filter((t) =>
    spans.some((s) => s.state !== 'active' && t >= s.from && t < s.to),
  ).length;
}

/** The longest wait between one photo finishing and the next (or the start), in ms. */
export function longestGap(start: number, finishedAt: readonly number[]): number {
  let last = start;
  let gap = 0;
  for (const t of [...finishedAt].sort((a, b) => a - b)) {
    gap = Math.max(gap, t - last);
    last = t;
  }
  return gap;
}

/** The session cookie's `name=value`, from a login answer's Set-Cookie header. */
export function sessionCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const first = setCookie.split(';')[0]?.trim() ?? '';
  return /^[^=\s]+=[^=\s]/.test(first) ? first : null;
}
