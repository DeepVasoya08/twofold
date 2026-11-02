import { useDownloadNoun, useDownloads } from '../app/downloads';
import { progressPercent } from '../lib/download-progress';
import { pluralize } from '../lib/format';
import { Icon } from './Icon';

// The card and progress bar styles are shared with uploads.
import './upload-dialog.css';
import './upload-progress.css';

/**
 * A small floating card while photos download with the dialog closed, and once they're ready
 * to save. Clicking it opens the download dialog again, where they're saved (the share sheet
 * needs that tap).
 */
export function DownloadProgress() {
  const { job, dialogOpen, openDialog } = useDownloads();
  const noun = useDownloadNoun(job?.photoIds ?? []);
  if (dialogOpen || !job) return null;
  const { stage } = job;
  if (stage.state !== 'downloading' && stage.state !== 'ready') return null;

  const total = job.photoIds.length;
  const downloading = stage.state === 'downloading';
  const label = downloading
    ? `Downloading ${String(Math.min(stage.progress.done + 1, total))} of ${String(total)}`
    : `${pluralize(total, noun)} ready to save`;
  const percent = downloading ? progressPercent(stage.progress) : 100;

  return (
    <button
      type="button"
      className="upload-progress"
      onClick={openDialog}
      aria-label={`${label}. Show download`}
    >
      <Icon name="download" size={18} />
      <span className="upload-progress__body">
        <span className="upload-progress__label">{label}</span>
        {downloading ? (
          <span
            className="progress"
            role="progressbar"
            aria-label="Download progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span className="progress__bar" style={{ width: `${String(percent)}%` }} />
          </span>
        ) : (
          <span className="upload-progress__hint">Tap to save</span>
        )}
      </span>
    </button>
  );
}
