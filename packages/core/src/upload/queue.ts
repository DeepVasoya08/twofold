/** How many photos upload at once. Hides each upload's round trips behind the others'. */
export const UPLOADS_AT_ONCE = 3;

/**
 * The most original bytes being uploaded at once. Each photo is held about three times while
 * it uploads (the file, its bytes and its ciphertext), so this keeps memory near 150 MB on a
 * phone. A photo bigger than this still uploads, on its own.
 */
export const UPLOAD_BYTES_AT_ONCE = 48 * 1024 * 1024;

/** The uploads in progress. */
export interface InFlight {
  count: number;
  bytes: number;
}

/** Whether a photo of `size` bytes may start now, next to the uploads in flight. */
export function canStartUpload(inFlight: InFlight, size: number): boolean {
  if (inFlight.count === 0) return true;
  return inFlight.count < UPLOADS_AT_ONCE && inFlight.bytes + size <= UPLOAD_BYTES_AT_ONCE;
}
