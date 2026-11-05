import { requireNativeModule } from 'expo';

interface UploadServiceModule {
  /** Starts the foreground service, or updates its progress. Call it first on screen. */
  show(text: string, done: number, total: number): void;
  stop(): void;
  /** Says the uploads finished, when Arcafold may post notifications. */
  notifyFinished(title: string, text: string): void;
}

/**
 * The Android foreground service that keeps uploads running with Arcafold in the
 * background or the screen off, and the notification when they finish.
 */
export const UploadService = requireNativeModule<UploadServiceModule>('ArcafoldUploadService');
