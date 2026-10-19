import { useEffect, useEffectEvent, useState } from 'react';

import { errorMessage } from '../app/account-ops';
import { useVault } from '../app/vault';
import { pluralize } from '../lib/format';
import { DOWNLOAD_MAX, downloadFiles } from '../lib/download-files';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

import './download-dialog.css';

type Prepared =
  | { state: 'decrypting' }
  | { state: 'ready'; files: File[] }
  | { state: 'failed'; message: string };

/**
 * Saves copies of photos to this device. Their originals are decrypted into memory first, so
 * the download starts straight from a tap. The copies are saved without Twofold's encryption,
 * and the dialog says so.
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
  const { originals } = useVault();
  const tooMany = photoIds.length > DOWNLOAD_MAX;
  const [prepared, setPrepared] = useState<Prepared>({ state: 'decrypting' });
  // The vault's functions change with every thumbnail that arrives; decrypting starts once.
  const decrypt = useEffectEvent((ids: readonly string[]) => originals(ids));

  useEffect(() => {
    if (tooMany || photoIds.length === 0) return;
    let cancelled = false;
    decrypt(photoIds).then(
      (files) => {
        if (!cancelled) setPrepared({ state: 'ready', files });
      },
      (error: unknown) => {
        if (!cancelled) setPrepared({ state: 'failed', message: errorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [photoIds, tooMany]);

  if (photoIds.length === 0) {
    return <p className="download__note">There are no photos in here to download yet.</p>;
  }
  if (tooMany) {
    return (
      <p className="download__note">
        Twofold downloads up to {String(DOWNLOAD_MAX)} photos at a time. Pick fewer, then try again.
      </p>
    );
  }

  const files = prepared.state === 'ready' ? prepared.files : null;
  return (
    <section className="download">
      <p className="download__note">
        Saves the originals to this device. Downloaded copies aren’t encrypted, so keep them
        somewhere you trust.
      </p>
      {prepared.state === 'failed' ? (
        <p className="download__error" role="alert">
          {prepared.message}
        </p>
      ) : (
        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={!files}
          aria-busy={!files}
          onClick={() => {
            if (!files) return;
            downloadFiles(files);
            onDone();
          }}
        >
          <Icon name="download" size={18} />
          {files ? 'Download' : 'Decrypting…'}
        </button>
      )}
    </section>
  );
}
