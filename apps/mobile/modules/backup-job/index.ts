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
  /** Whether each job is waiting with Android, and what they last did. */
  status(): BackupJobStatus;
  /** Runs the backup once in the background, as soon as the network rule allows. */
  runSoon(): void;
}

export interface BackupJobStatus {
  on: boolean;
  /** The job that runs after a new photo is set with Android. */
  onChangeWaiting: boolean;
  /** The six-hourly job is set with Android. */
  periodicWaiting: boolean;
  /** When a job last started and ended, in ms since 1970 (0 for never). */
  lastStart: number;
  lastEnd: number;
  /** What the jobs last did, in a few words. */
  note: string;
}

/** Android's JobScheduler jobs that run automatic backup (the "ArcafoldBackup" task). */
export const BackupJob = requireNativeModule<BackupJobModule>('ArcafoldBackupJob');
