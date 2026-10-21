import { useEffect, useEffectEvent, useMemo, useState } from 'react';

import { errorMessage } from '../app/account-ops';
import { useVault } from '../app/vault';
import { downloadFiles } from '../lib/download-files';
import { progressPercent } from '../lib/download-progress';
import type { DownloadProgress } from '../lib/download-progress';
import { pluralize } from '../lib/format';
import {
  DOWNLOAD_MAX_BYTES,
  browserEnvironment,
  prepareCopies,
  saveLabel,
  savePrepared,
  zipFiles,
} from '../lib/save-copies';
import type { PreparedCopies } from '../lib/save-copies';
import { formatBytes } from '../lib/storage-usage';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

import './download-dialog.css';
// The shared progress bar styles live with the upload dialog.
import './upload-dialog.css';

type Preparing =
  | { state: 'downloading'; progress: DownloadProgress }
  | { state: 'ready'; prepared: PreparedCopies; note?: string }
  | { state: 'failed'; message: string };

const SHARE_FAILED = 'The share sheet didn’t open, so the photos will download as a zip instead.';

/**
 * Saves copies of photos to this device. Their originals are downloaded and decrypted into
 * memory first, a few at a time, so saving starts straight from a tap (the share sheet only
 * opens for one). One photo is saved as is; several go to the share sheet on phones, or
 * download as one zip. The copies are saved without Twofold's encryption, and the dialog says
 * so.
 */
export function DownloadDialog({
  open,
  photoIds,
  onClose,
}: {
  open: boolean;
  photoIds: readonly string[];
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        photoIds.length === 1
          ? 'Download this photo'
          : `Download ${pluralize(photoIds.length, 'photo')}`
      }
    >
      <DownloadCopies photoIds={photoIds} onDone={onClose} />
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so closing it drops the decrypted copies. */
function DownloadCopies({ photoIds, onDone }: { photoIds: readonly string[]; onDone: () => void }) {
  const { originals, state } = useVault();
  const totalBytes = useMemo(() => {
    const wanted = new Set(photoIds);
    return state.photos
      .filter((photo) => wanted.has(photo.id))
      .reduce((sum, photo) => sum + (photo.size ?? 0), 0);
  }, [photoIds, state.photos]);
  const tooLarge = totalBytes > DOWNLOAD_MAX_BYTES;
  const [preparing, setPreparing] = useState<Preparing>({
    state: 'downloading',
    progress: { done: 0, total: photoIds.length, bytesDone: 0, bytesTotal: 0 },
  });
  // The vault's functions change with every thumbnail that arrives; downloading starts once.
  const download = useEffectEvent(
    (
      ids: readonly string[],
      onProgress: (progress: DownloadProgress) => void,
      signal: AbortSignal,
    ) => originals(ids, { onProgress, signal }),
  );

  useEffect(() => {
    if (tooLarge || photoIds.length === 0) return;
    const controller = new AbortController();
    const { signal } = controller;
    const onProgress = (progress: DownloadProgress) => {
      if (!signal.aborted) setPreparing({ state: 'downloading', progress });
    };
    download(photoIds, onProgress, signal)
      .then((copies) => prepareCopies(copies, browserEnvironment()))
      .then(
        (prepared) => {
          if (!signal.aborted) setPreparing({ state: 'ready', prepared });
        },
        (error: unknown) => {
          if (!signal.aborted) setPreparing({ state: 'failed', message: errorMessage(error) });
        },
      );
    return () => {
      controller.abort();
    };
  }, [photoIds, tooLarge]);

  if (photoIds.length === 0) {
    return <p className="download__note">There are no photos in here to download yet.</p>;
  }
  if (tooLarge) {
    return (
      <p className="download__note">
        Twofold downloads up to {formatBytes(DOWNLOAD_MAX_BYTES)} at a time, and these photos come
        to {formatBytes(totalBytes)}. Pick fewer, then try again.
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
        onDone();
      } else if (outcome === 'failed') {
        // A zip still works: offer it, and let the next tap download it.
        const zip = await zipFiles(prepared.files);
        setPreparing({
          state: 'ready',
          prepared: { method: 'zip', files: [zip] },
          note: SHARE_FAILED,
        });
      }
    });
  };

  return (
    <section className="download">
      <p className="download__note">
        Saves the originals to this device. Downloaded copies aren’t encrypted, so keep them
        somewhere you trust.
      </p>
      {preparing.state === 'failed' && (
        <p className="download__error" role="alert">
          {preparing.message}
        </p>
      )}
      {preparing.state === 'downloading' && <DownloadStatus progress={preparing.progress} />}
      {preparing.state === 'ready' && (
        <>
          {preparing.note && <p className="download__note">{preparing.note}</p>}
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => {
              save(preparing.prepared);
            }}
          >
            <Icon name="download" size={18} />
            {saveLabel(preparing.prepared.method)}
          </button>
        </>
      )}
    </section>
  );
}

function DownloadStatus({ progress }: { progress: DownloadProgress }) {
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
