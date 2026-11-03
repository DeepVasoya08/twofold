import { requireNativeModule } from 'expo';

interface BackupServiceModule {
  /** Starts the foreground service, or updates its notification. Call first from the foreground. */
  show(text: string, done: number, total: number): void;
  stop(): void;
  ignoresBatteryOptimizations(): boolean;
}

/** The Android foreground service that keeps a backup running in the background. */
export const BackupService = requireNativeModule<BackupServiceModule>('ArcafoldBackupService');
