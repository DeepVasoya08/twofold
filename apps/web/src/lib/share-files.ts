/**
 * Sending decrypted copies of photos out of Twofold: the device's share sheet where it can
 * take files, else a download. The files live only in memory; download links are revoked
 * as soon as the browser has them.
 */

/** Most photos sent at once. Each is decrypted in full into memory first. */
export const SHARE_MAX = 50;

/** Whether this browser's share sheet can take these files. */
export function canShareFiles(files: readonly File[], nav: Navigator = navigator): boolean {
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files: [...files] });
  } catch {
    return false;
  }
}

/** Opens the share sheet. Resolves false if the person closed it without sharing. */
export async function shareFiles(
  files: readonly File[],
  nav: Navigator = navigator,
): Promise<boolean> {
  try {
    await nav.share({ files: [...files] });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    throw error;
  }
}

/** How long a download link lives: long enough for the browser to start saving. */
const REVOKE_MS = 10_000;

/** Saves each file through a temporary link. */
export function downloadFiles(files: readonly File[], doc: Document = document): void {
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const link = doc.createElement('a');
    link.href = url;
    link.download = file.name;
    link.rel = 'noopener';
    doc.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, REVOKE_MS);
  }
}
