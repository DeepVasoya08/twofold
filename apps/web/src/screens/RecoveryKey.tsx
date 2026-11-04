import { useEffect, useState } from 'react';

import { useAccount } from '../app/account';
import { newRecoveryWords } from '../app/account-ops';
import { useRouter } from '../app/router';
import { parseNext, paths } from '../app/routes';
import { useToast } from '../app/toast';
import { useSubmit } from '../app/use-submit';
import { AuthLayout } from '../components/AuthLayout';
import { FormAlert } from '../components/FormAlert';
import { Icon } from '../components/Icon';
import { downloadFiles } from '../lib/download-files';
import { RECOVERY_FILE_NAME, recoveryFile } from '../lib/recovery-file';

import './recovery-key.css';

/**
 * Step 2 of sign-up, or a replacement key from Settings. The words are made on this device
 * and are never sent anywhere; only a slot sealed with them is.
 */
export function RecoveryKey() {
  const { navigate, search } = useRouter();
  const toast = useToast();
  const { pendingSignUp, completeSignUp, saveRecoveryKey } = useAccount();
  const { busy, error, run } = useSubmit();
  const [saved, setSaved] = useState(false);
  // Ticking the box saves a copy once; the Download button is there for another.
  const [downloaded, setDownloaded] = useState(false);
  const signingUp = pendingSignUp !== null;
  const [renewal, setRenewal] = useState<{ key: Uint8Array; words: string[] } | null>(null);

  useEffect(() => {
    if (signingUp) return;
    let cancelled = false;
    void newRecoveryWords().then((made) => {
      if (!cancelled) setRenewal(made);
    });
    return () => {
      cancelled = true;
    };
  }, [signingUp]);

  const words = pendingSignUp?.recoveryWords ?? renewal?.words ?? [];

  const copy = () => {
    void navigator.clipboard.writeText(words.join(' ')).then(
      () => {
        toast.show('Recovery key copied');
      },
      () => {
        toast.show('Copy failed. Write the words down instead.');
      },
    );
  };

  const download = () => {
    downloadFiles([recoveryFile(words)]);
    setDownloaded(true);
  };

  const onContinue = () => {
    if (signingUp) {
      void run(completeSignUp).then((ok) => {
        // Back to the invite link they followed, if they came from one.
        if (ok) navigate(parseNext(search) ?? paths.gallery);
      });
      return;
    }
    if (!renewal) return;
    void run(() => saveRecoveryKey(renewal.key)).then((ok) => {
      if (!ok) return;
      toast.show('New recovery key saved');
      navigate(paths.settings);
    });
  };

  return (
    <AuthLayout
      title="Save your recovery key"
      subtitle={
        signingUp
          ? 'If you ever forget your password, these 12 words are the only way back into your photos. Not even we can help without them.'
          : 'These 12 words replace your old recovery key, which stops working once you continue.'
      }
      {...(signingUp ? { step: { current: 2, total: 2 } } : {})}
    >
      <div className="recovery">
        <ol className="recovery__words" aria-label="Recovery key" aria-busy={words.length === 0}>
          {words.map((word, index) => (
            <li key={index} className="recovery__word">
              {word}
            </li>
          ))}
        </ol>
        <div className="recovery__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={copy}
            disabled={words.length === 0}
          >
            <Icon name="copy" size={18} />
            Copy words
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={download}
            disabled={words.length === 0}
          >
            <Icon name="download" size={18} />
            Download
          </button>
        </div>
      </div>

      <ul className="tips">
        <li>
          <Icon name="check" size={16} /> Write them on paper, or keep them in a password manager.
        </li>
        <li>
          <Icon name="check" size={16} /> Don&apos;t share them with anyone.
        </li>
      </ul>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => {
            const checked = event.currentTarget.checked;
            setSaved(checked);
            if (checked && !downloaded && words.length > 0) download();
          }}
        />
        <span>I&apos;ve saved my recovery key somewhere safe</span>
      </label>
      <p className="recovery__note">
        {downloaded
          ? `Also downloaded to this device as ${RECOVERY_FILE_NAME}.`
          : 'Ticking this also downloads the words as a text file, just in case.'}
      </p>

      <FormAlert message={error} />
      <button
        type="button"
        className="btn btn--primary btn--block btn--lg"
        disabled={!saved || busy || words.length === 0}
        aria-busy={busy}
        onClick={onContinue}
      >
        {busy ? 'Saving…' : 'Continue'}
      </button>
    </AuthLayout>
  );
}
