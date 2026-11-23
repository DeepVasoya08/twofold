import { padPreview } from '@arcafold/core/file-types';

/**
 * Previews of files that aren't photos, made to suit the device. A PDF's first page becomes
 * its preview once, on the device that uploads it, and is stored encrypted like a photo's;
 * every other device just shows that small image. Phones with little memory, or ones that
 * turn out slow, make a smaller preview or none (an icon shows instead), and read a PDF a
 * page at a time.
 */

/** How much a device draws: everything at full size, or less and smaller. */
export type PreviewTier = 'full' | 'light';

interface NavigatorLike {
  userAgent: string;
  userAgentData?: { mobile?: boolean };
  hardwareConcurrency?: number;
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

/** Longest side of a preview, in pixels. */
export const TILE_SIDE: Record<PreviewTier, number> = { full: 480, light: 240 };

/** Longest a preview may take before the upload goes ahead with an icon instead. */
export const TILE_BUDGET_MS: Record<PreviewTier, number> = { full: 8000, light: 3000 };

export { PREVIEW_MIN_BYTES, padPreview } from '@arcafold/core/file-types';

/** Set once a preview here ran out of time: this device draws less from then on. */
let ranSlow = false;

function isPhoneLike(nav: NavigatorLike): boolean {
  if (typeof nav.userAgentData?.mobile === 'boolean') return nav.userAgentData.mobile;
  return /Android|iPhone|iPod|Mobile/i.test(nav.userAgent);
}

/**
 * What this device should draw: light on a phone with 4 GB of memory or less, or 4 cores
 * or fewer, with data saver on, or once a preview has run out of time here.
 */
export function previewTier(nav: NavigatorLike, slow: boolean = ranSlow): PreviewTier {
  if (slow || nav.connection?.saveData === true) return 'light';
  if (!isPhoneLike(nav)) return 'full';
  const lowMemory = nav.deviceMemory !== undefined && nav.deviceMemory <= 4;
  const fewCores = nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 4;
  return lowMemory || fewCores ? 'light' : 'full';
}

/** This browser's tier. */
export function currentPreviewTier(): PreviewTier {
  return typeof navigator === 'undefined' ? 'full' : previewTier(navigator);
}

/** Records that a preview ran out of time, so later ones draw less. */
export function markSlow(): void {
  ranSlow = true;
}

/** Forgets that, for tests. */
export function resetSlow(): void {
  ranSlow = false;
}

/** `work`, or null if it takes longer than `ms` or fails. Running out of time marks this device slow. */
export async function withinBudget<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => {
      resolve('late');
    }, ms);
  });
  try {
    const result = await Promise.race([work, late]);
    if (result === 'late') {
      markSlow();
      return null;
    }
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Draws a PDF's first page as a JPEG preview for `tier`, within its time budget. Null when
 * it can't be read or takes too long; the file then shows its icon.
 */
export async function pdfPreview(
  bytes: Uint8Array,
  tier: PreviewTier = currentPreviewTier(),
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof document === 'undefined') return null;
  const controller = new AbortController();
  const drawn = withinBudget(
    drawFirstPage(bytes, TILE_SIDE[tier], controller.signal),
    TILE_BUDGET_MS[tier],
  );
  const jpeg = await drawn;
  if (!jpeg) controller.abort();
  return jpeg && padPreview(jpeg);
}

async function drawFirstPage(
  bytes: Uint8Array,
  side: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const { openPdf, drawPage, closePdf } = await import('./pdf');
  const doc = await openPdf(bytes);
  try {
    const page = await doc.getPage(1);
    const { width, height } = page.getViewport({ scale: 1 });
    const cssWidth = width >= height ? side : (side * width) / height;
    const canvas = document.createElement('canvas');
    await drawPage(doc, 1, canvas, cssWidth, 1, signal);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.8);
    });
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } finally {
    closePdf(doc);
  }
}
