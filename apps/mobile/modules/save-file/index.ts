import { requireOptionalNativeModule } from 'expo';

interface SaveFileModule {
  /** Opens Android's "Save to" screen; true once the file is written, false if cancelled. */
  saveTextAsync(name: string, text: string): Promise<boolean>;
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
