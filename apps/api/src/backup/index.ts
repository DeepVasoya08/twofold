import { syncBackup } from './sync';

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
    if (result.failed > 0 || result.guarded) {
      // A failed run shows up in the Worker's metrics as well as its logs.
      throw new Error('Backup run incomplete.');
    }
  },
} satisfies ExportedHandler<BackupEnv>;
