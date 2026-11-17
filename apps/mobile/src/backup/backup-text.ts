import type { BackupStatus } from './use-backup';

const photos = (count: number) => `${String(count)} photo${count === 1 ? '' : 's'}`;

/** What Settings says about the last "Back up now", or null when there's nothing to say. */
export function backupStatusText(status: BackupStatus): string | null {
  switch (status.kind) {
    case 'idle':
      return null;
    case 'running':
      return status.done === 0
        ? 'Looking for new photos…'
        : `Backing up… ${photos(status.done)} done`;
    case 'failed':
      return status.message;
    case 'done': {
      if (status.added === 0 && status.skipped === 0) return 'Nothing new to back up.';
      const added = status.added > 0 ? `Backed up ${photos(status.added)}.` : '';
      const skipped =
        status.skipped > 0
          ? `${photos(status.skipped)} couldn’t be backed up and were skipped.`
          : '';
      return [added, skipped].filter(Boolean).join(' ');
    }
  }
}
