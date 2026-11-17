import type { BackupJobStatus } from '../../modules/backup-job';

function clock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** What Settings says about Android's background jobs, to see why one hasn't run. */
export function jobStatusText(status: BackupJobStatus | null): string {
  if (!status?.on) return 'Background: not set up. Turn backup off and on again.';
  const waiting = [
    status.onChangeWaiting ? 'new photos' : null,
    status.periodicWaiting ? 'every six hours' : null,
  ].filter(Boolean);
  const parts = [
    waiting.length > 0
      ? `Background: waiting for ${waiting.join(' and ')}.`
      : 'Background: no job is waiting with Android.',
    status.lastStart > 0 ? `Last started at ${clock(status.lastStart)}.` : 'Never started yet.',
  ];
  if (status.note) parts.push(`(${status.note})`);
  return parts.join(' ');
}
