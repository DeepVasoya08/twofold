import { isHeif } from './heif';
import { pageThumbnailer, workerThumbnailer } from './thumbnailer';
import type { Thumbnailer } from './thumbnailer';

/**
 * The app's one thumbnailer: in a Web Worker where there is one, so the page stays smooth
 * while photos are decoded and scaled, and on the page otherwise.
 */
let thumbnailer: Promise<Thumbnailer> | null = null;

export const loadThumbnailer = (): Promise<Thumbnailer> =>
  (thumbnailer ??=
    typeof Worker === 'undefined'
      ? Promise.resolve(pageThumbnailer)
      : import('./spawn-thumbnail-worker').then(({ spawnThumbnailWorker }) =>
          workerThumbnailer(spawnThumbnailWorker),
        ));

/** The longest side of a copy made for viewing: a 12 MP phone photo keeps every pixel. */
export const VIEW_MAX_SIDE = 4096;

/** Whether this browser shows HEIC photos itself (Safari does), once worked out. */
let showsHeif: boolean | undefined;

async function browserShows(original: Blob): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(original);
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * A JPEG copy to show in place of an original this browser can't show (HEIC outside Safari),
 * made in memory and never stored. Null when the original shows as it is, or can't be read.
 */
export async function viewableCopy(
  original: Uint8Array<ArrayBuffer>,
  type: string,
  load: () => Promise<Thumbnailer> = loadThumbnailer,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!isHeif(original)) return null;
  const blob = new Blob([original], { type });
  showsHeif ??= await browserShows(blob);
  if (showsHeif) return null;
  const copy = await (await load())(blob, VIEW_MAX_SIDE);
  return copy?.bytes ?? null;
}
