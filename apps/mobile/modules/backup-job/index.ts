import { requireNativeModule } from 'expo';

interface BackupJobModule {
  /**
   * Has Android run the backup task soon after photos are added, and every six hours, on
   * Wi-Fi (or any network with `mobileData`) with a battery that isn't low. Calling it again
   * updates the network rule.
   */
  schedule(mobileData: boolean): void;
  /** Stops both jobs. */
  cancel(): void;
}

/** Android's JobScheduler jobs that run automatic backup (the "ArcafoldBackup" task). */
export const BackupJob = requireNativeModule<BackupJobModule>('ArcafoldBackupJob');
