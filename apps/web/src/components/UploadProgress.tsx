import { useUploads } from '../app/uploads';
import { pluralize } from '../lib/format';
import { Icon } from './Icon';

// The shared progress bar styles live with the upload dialog.
import './upload-dialog.css';
import './upload-progress.css';

/**
 * A small floating card while photos upload with the dialog closed, so it's clear they're
 * still going. Clicking it opens the upload list again. It stays after the uploads end only
 * when some photos failed, until the list has been looked at.
 */
export function UploadProgress() {
  const { summary, running, dialogOpen, openDialog } = useUploads();
  if (dialogOpen || summary.total === 0) return null;

  const label = running
    ? `${String(summary.done)} of ${pluralize(summary.total, 'photo')} uploaded`
    : `${pluralize(summary.failed, 'photo')} couldn’t upload`;

  return (
    <button
      type="button"
      className={`upload-progress${running ? '' : ' is-failed'}`}
      onClick={openDialog}
      aria-label={`${label}. Show uploads`}
    >
      <Icon name={running ? 'upload' : 'info'} size={18} />
      <span className="upload-progress__body">
        <span className="upload-progress__label">{label}</span>
        {running && (
          <span
            className="progress"
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={summary.percent}
          >
            <span className="progress__bar" style={{ width: `${String(summary.percent)}%` }} />
          </span>
        )}
      </span>
    </button>
  );
}
