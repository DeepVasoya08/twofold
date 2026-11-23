import { requireOptionalNativeModule } from 'expo';

interface SaveFileModule {
  /** Opens Android's "Save to" screen; true once the file is written, false if cancelled. */
  saveTextAsync(name: string, text: string): Promise<boolean>;
  /** Copies bytes into native memory, to save next; returns what to save them by. */
  hold(bytes: Uint8Array): string;
  /** Writes held bytes into the gallery (or Download/Arcafold), then wipes them. */
  saveToGalleryAsync(id: string, name: string, type: string, takenAt: number): Promise<void>;
  /** Offers held bytes to the apps that open their type; false when none does. */
  openAsync(id: string, name: string, type: string): Promise<boolean>;
  /** Wipes the file last opened in another app. */
  forgetOpened(): void;
}

const native = requireOptionalNativeModule<SaveFileModule>('ArcafoldSaveFile');

/**
 * Saves a text file where the person picks (Downloads by default). Returns false when they
 * cancel, or on a phone without the module (iOS, for now).
 */
export async function saveTextFile(name: string, text: string): Promise<boolean> {
  if (!native) return false;
  return native.saveTextAsync(name, text);
}

/** A decrypted copy to put on the phone. */
export interface PhoneCopy {
  bytes: Uint8Array;
  /** What to call it; the gallery adds ` (1)` and so on if the name is taken. */
  name: string;
  type: string;
  /** When it was taken, in milliseconds, so the gallery sorts it there (0 if unknown). */
  takenAt: number;
}

/** Whether this phone can put copies in its gallery (Android, for now). */
export const canSaveToGallery = native !== null;

/**
 * Puts a copy into the phone's gallery, in Pictures/Arcafold (or Download/Arcafold for a file
 * that isn't a photo or video), straight from memory. The JavaScript copy of the bytes is
 * wiped once it's handed over.
 */
export async function saveToGallery(copy: PhoneCopy): Promise<void> {
  if (!native) throw new Error('This phone can’t save copies yet.');
  let id: string;
  try {
    id = native.hold(copy.bytes);
  } finally {
    copy.bytes.fill(0);
  }
  await native.saveToGalleryAsync(id, copy.name, copy.type, copy.takenAt);
}

/**
 * Offers a decrypted file to the apps that can open it (Android's "Open with"), read
 * straight from memory: no copy is written to disk. The JavaScript copy of the bytes is
 * wiped once it's handed over; the native one stays until another file opens or the app
 * locks. Resolves false when no app on the phone opens that kind of file.
 */
export async function openInApp(file: { bytes: Uint8Array; name: string; type: string }) {
  if (!native) throw new Error('This phone can’t open files yet.');
  let id: string;
  try {
    id = native.hold(file.bytes);
  } finally {
    file.bytes.fill(0);
  }
  return native.openAsync(id, file.name, file.type);
}

/** Wipes the file last opened in another app, as when the library closes. */
export function forgetOpened(): void {
  native?.forgetOpened();
}
