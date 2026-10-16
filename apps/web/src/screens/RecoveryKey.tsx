import { useState } from 'react';

import { useRouter } from '../app/router';
import { paths } from '../app/routes';
import { useToast } from '../app/toast';
import { AuthLayout } from '../components/AuthLayout';
import { Icon } from '../components/Icon';
import { mockRecoveryKey } from '../mock/data';

import './recovery-key.css';

export function RecoveryKey() {
  const { navigate } = useRouter();
  const toast = useToast();
  const [saved, setSaved] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(mockRecoveryKey.join(' ')).then(
      () => {
        toast.show('Recovery key copied');
      },
      () => {
        toast.show('Copy failed. Write the words down instead.');
      },
    );
  };

  return (
    <AuthLayout
      title="Save your recovery key"
      subtitle="If you ever forget your password, these 12 words are the only way back into your photos. Not even we can help without them."
      step={{ current: 2, total: 2 }}
    >
      <div className="recovery">
        <ol className="recovery__words" aria-label="Recovery key">
          {mockRecoveryKey.map((word) => (
            <li key={word} className="recovery__word">
              {word.toLowerCase()}
            </li>
          ))}
        </ol>
        <div className="recovery__actions">
          <button type="button" className="btn btn--secondary" onClick={copy}>
            <Icon name="copy" size={18} />
            Copy words
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
            setSaved(event.currentTarget.checked);
          }}
        />
        <span>I&apos;ve saved my recovery key somewhere safe</span>
      </label>

      <button
        type="button"
        className="btn btn--primary btn--block btn--lg"
        disabled={!saved}
        onClick={() => {
          navigate(paths.gallery);
        }}
      >
        Continue
      </button>
    </AuthLayout>
  );
}
