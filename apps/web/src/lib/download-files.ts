/**
 * Saving decrypted copies of photos to the device. The files live only in memory; download
 * links are revoked as soon as the browser has them.
 */

/** Most photos downloaded at once. Each is decrypted in full into memory first. */
export const DOWNLOAD_MAX = 50;

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
