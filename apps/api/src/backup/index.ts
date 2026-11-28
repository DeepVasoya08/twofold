import { syncBackup } from './sync';

/**
 * A file still waiting to be copied this long after it settled means the backup is falling
 * behind (more new files than runs can copy, or copies failing), so the run says so.
 */
export const BEHIND_ALERT_MS = 6 * 60 * 60 * 1000;

/** The backup Worker's bindings (wrangler.backup.jsonc). */
export interface BackupEnv {
  /** The photo bucket. Only read and listed here. */
  SOURCE: R2Bucket;
  BACKUP: R2Bucket;
}

/**
 * The arcafold-backup Worker: no routes, only a schedule. It runs apart from the app so the
 * app's Worker never holds the backup bucket. Logs only counts, never file names.
 */
export default {
  async scheduled(controller, env) {
    const result = await syncBackup(env.SOURCE, env.BACKUP, new Date(controller.scheduledTime));
    if (result.guarded) {
      console.error('Photo bucket listed empty while copies exist; nothing was marked as gone.');
    }
    if (result.failed > 0) {
      console.error(`Backup run: ${String(result.failed)} operations failed; retrying next run.`);
    }
    const behind = result.behindMs > BEHIND_ALERT_MS;
    if (behind) {
      const hours = Math.round(result.behindMs / (60 * 60 * 1000));
      console.error(
        `Backup run: ${String(result.pending)} files still to copy, the oldest waiting ${String(hours)} hours.`,
      );
    }
    if (result.failed > 0 || result.guarded || behind) {
      // A failed run shows up in the Worker's metrics as well as its logs.
      throw new Error('Backup run incomplete.');
    }
  },
} satisfies ExportedHandler<BackupEnv>;
