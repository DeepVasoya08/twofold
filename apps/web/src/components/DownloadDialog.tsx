import { useDownloadNoun, useDownloads } from '../app/downloads';
import type { DownloadJob } from '../app/downloads';
import { downloadFiles } from '../lib/download-files';
import { progressPercent } from '../lib/download-progress';
import type { DownloadProgress } from '../lib/download-progress';
import { pluralize } from '../lib/format';
import { DOWNLOAD_MAX_BYTES, saveLabel, savePrepared, zipFiles } from '../lib/save-copies';
import type { PreparedCopies } from '../lib/save-copies';
import { formatBytes } from '../lib/storage-usage';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

import './download-dialog.css';
// The shared progress bar styles live with the upload dialog.
import './upload-dialog.css';

const SHARE_FAILED = 'The share sheet didn’t open, so the photos will download as a zip instead.';

/** "Download this photo", "Download 17 photos", or the same for files. */
export function downloadTitle(count: number, noun: 'photo' | 'file' = 'photo'): string {
  return count === 1 ? `Download this ${noun}` : `Download ${pluralize(count, noun)}`;
}

/**
 * Saves copies of photos to this device. Their originals are downloaded and decrypted into
 * memory first, a few at a time, so saving starts straight from a tap (the share sheet only
 * opens for one). One photo is saved as is; several go to the share sheet on phones, or
 * download as one zip. The copies are saved without Arcafold's encryption, and the dialog says
 * so. Closing the dialog doesn't stop the download: a card shows how it's going, and opening
 * the dialog again (from the card, or by downloading the same photos) carries on from there.
 * Start one with `useDownloads().start`; this is mounted once, in the app shell.
 */
export function DownloadDialog() {
  const { job, waiting, dialogOpen, closeDialog } = useDownloads();
  const ids = waiting ?? job?.photoIds ?? [];
  const noun = useDownloadNoun(ids);
  return (
    <Dialog
      open={dialogOpen && job !== null}
      onClose={closeDialog}
      title={downloadTitle(ids.length, noun)}
    >
      {job && (waiting ? <Busy job={job} /> : <DownloadCopies job={job} />)}
    </Dialog>
  );
}

/** Asked for other photos while a download is still going: wait for it, or stop it. */
function Busy({ job }: { job: DownloadJob }) {
  const { startWaiting } = useDownloads();
  return (
    <section className="download">
      <p className="download__note">
        Arcafold is still getting {pluralize(job.photoIds.length, 'other photo')} ready. Stop that
        download to start this one, or close this and let it finish.
      </p>
      {job.stage.state === 'downloading' && <DownloadStatus progress={job.stage.progress} />}
      <button type="button" className="btn btn--primary btn--block" onClick={startWaiting}>
        Stop it and download these
      </button>
    </section>
  );
}

function DownloadCopies({ job }: { job: DownloadJob }) {
  const { saved, cancel, replacePrepared } = useDownloads();
  const { stage } = job;

  if (stage.state === 'empty') {
    return <p className="download__note">There are no photos in here to download yet.</p>;
  }
  if (stage.state === 'too-large') {
    return (
      <p className="download__note">
        Arcafold downloads up to {formatBytes(DOWNLOAD_MAX_BYTES)} at a time, and these photos come
        to {formatBytes(stage.bytes)}. Pick fewer, then try again.
      </p>
    );
  }

  const save = (prepared: PreparedCopies) => {
    void savePrepared(prepared, {
      share: (data) => navigator.share(data),
      download: (files) => {
        downloadFiles(files);
      },
    }).then(async (outcome) => {
      if (outcome === 'saved') {
        saved();
      } else if (outcome === 'failed') {
        // A zip still works: offer it, and let the next tap download it.
        replacePrepared({ method: 'zip', files: [await zipFiles(prepared.files)] }, SHARE_FAILED);
      }
    });
  };

  return (
    <section className="download">
      <p className="download__note">
        Saves the originals to this device. Downloaded copies aren’t encrypted, so keep them
        somewhere you trust.
      </p>
      {stage.state === 'failed' && (
        <p className="download__error" role="alert">
          {stage.message}
        </p>
      )}
      {stage.state === 'downloading' && (
        <>
          <DownloadStatus progress={stage.progress} />
          <p className="download__note">You can close this and keep using Arcafold.</p>
          <button type="button" className="btn btn--ghost btn--block" onClick={cancel}>
            Cancel download
          </button>
        </>
      )}
      {stage.state === 'ready' && (
        <>
          {stage.note && <p className="download__note">{stage.note}</p>}
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => {
              save(stage.prepared);
            }}
          >
            <Icon name="download" size={18} />
            {saveLabel(stage.prepared.method)}
          </button>
        </>
      )}
    </section>
  );
}

export function DownloadStatus({ progress }: { progress: DownloadProgress }) {
  const percent = progressPercent(progress);
  return (
    <div className="download__status" aria-live="polite">
      <p className="download__progress-label">
        Downloading {String(Math.min(progress.done + 1, progress.total))} of{' '}
        {String(progress.total)}
        {progress.bytesTotal > 0 && (
          <span className="download__bytes">
            {formatBytes(progress.bytesDone)} of {formatBytes(progress.bytesTotal)}
          </span>
        )}
      </p>
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
    </div>
  );
}
