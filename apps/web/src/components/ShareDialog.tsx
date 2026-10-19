import { useEffect, useEffectEvent, useState } from 'react';
import type { ReactNode } from 'react';

import { errorMessage } from '../app/account-ops';
import { useVault } from '../app/vault';
import { pluralize } from '../lib/format';
import { SHARE_MAX, canShareFiles, downloadFiles, shareFiles } from '../lib/share-files';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

import './share-dialog.css';

type Prepared =
  | { state: 'decrypting' }
  | { state: 'ready'; files: File[] }
  | { state: 'failed'; message: string };

/**
 * Sends copies of photos to another app or person. Their originals are decrypted into
 * memory first, so the share sheet opens straight from a tap (browsers only open it right
 * after one). The copies leave Twofold unencrypted, and the dialog says so.
 */
export function ShareDialog({
  open,
  photoIds,
  onClose,
  children,
}: {
  open: boolean;
  photoIds: readonly string[];
  onClose: () => void;
  /** More ways to share, below sending copies. */
  children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        photoIds.length === 1 ? 'Share this photo' : `Share ${pluralize(photoIds.length, 'photo')}`
      }
    >
      <ShareCopies photoIds={photoIds} onDone={onClose} />
      {children}
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so closing it drops the decrypted copies. */
function ShareCopies({ photoIds, onDone }: { photoIds: readonly string[]; onDone: () => void }) {
  const { originals } = useVault();
  const tooMany = photoIds.length > SHARE_MAX;
  const [prepared, setPrepared] = useState<Prepared>({ state: 'decrypting' });
  const [sending, setSending] = useState(false);
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
    return <p className="share-copies__note">There are no photos in here to send yet.</p>;
  }
  if (tooMany) {
    return (
      <p className="share-copies__note">
        Twofold sends up to {String(SHARE_MAX)} photos at a time. Pick fewer, then share again.
      </p>
    );
  }

  const files = prepared.state === 'ready' ? prepared.files : null;
  const viaSheet = files !== null && canShareFiles(files);
  const send = () => {
    if (!files || sending) return;
    if (!viaSheet) {
      downloadFiles(files);
      onDone();
      return;
    }
    setSending(true);
    shareFiles(files).then(
      (shared) => {
        setSending(false);
        if (shared) onDone();
      },
      (error: unknown) => {
        setSending(false);
        setPrepared({ state: 'failed', message: errorMessage(error) });
      },
    );
  };

  return (
    <section className="share-copies">
      <p className="share-copies__note">
        Sends copies to another app or person. The copies leave Twofold without its encryption, so
        only send them somewhere you trust.
      </p>
      {prepared.state === 'failed' ? (
        <p className="share-copies__error" role="alert">
          {prepared.message}
        </p>
      ) : (
        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={!files || sending}
          aria-busy={!files || sending}
          onClick={send}
        >
          <Icon name={viaSheet || !files ? 'share' : 'download'} size={18} />
          {!files ? 'Decrypting…' : viaSheet ? 'Send copies' : 'Download copies'}
        </button>
      )}
    </section>
  );
}
