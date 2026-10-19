/** Where one photo of an upload stands. */
export type UploadStatus = 'waiting' | 'encrypting' | 'uploading' | 'done' | 'failed';

/** How far along each status is, as a percentage of that photo's upload. */
export const STATUS_PROGRESS: Record<UploadStatus, number> = {
  waiting: 0,
  encrypting: 25,
  uploading: 60,
  done: 100,
  failed: 100,
};

export const isUploadRunning = (status: UploadStatus): boolean =>
  status === 'waiting' || status === 'encrypting' || status === 'uploading';

/** All the photos added since the upload list was last cleared, taken together. */
export interface UploadSummary {
  total: number;
  done: number;
  failed: number;
  running: number;
  /** Overall progress, 0 to 100. */
  percent: number;
}

export function summarizeUploads(statuses: readonly UploadStatus[]): UploadSummary {
  let done = 0;
  let failed = 0;
  let progress = 0;
  for (const status of statuses) {
    if (status === 'done') done += 1;
    if (status === 'failed') failed += 1;
    progress += STATUS_PROGRESS[status];
  }
  const total = statuses.length;
  return {
    total,
    done,
    failed,
    running: total - done - failed,
    percent: total === 0 ? 0 : Math.round(progress / total),
  };
}
