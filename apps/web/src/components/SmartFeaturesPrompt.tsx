import { useState } from 'react';

import { SMART_FEATURES_VERSION } from '@twofold/types';
import type { SmartFeaturesChoice } from '@twofold/types';

import { useAccount } from '../app/account';
import { errorMessage } from '../app/account-ops';
import { usePeople } from '../app/people';
import { useToast } from '../app/toast';
import { MODEL_DOWNLOAD_MB } from '../lib/people/models';
import { Dialog } from './Dialog';

import './smart-features-prompt.css';

/** Whether the account still has to answer the current smart features question. */
export function needsSmartFeaturesAnswer(answer: SmartFeaturesChoice | null): boolean {
  return answer === null || answer.version < SMART_FEATURES_VERSION;
}

/**
 * The smart features question, asked once after sign-up and once to accounts made before it
 * existed. Saying yes is the consent face grouping needs, so it's a real choice: two
 * buttons, nothing ticked for them. The answer belongs to the account (the same in both
 * spaces) and sets this device too; closing it without answering asks again later.
 */
export function SmartFeaturesPrompt() {
  const { state, smartFeatures, chooseSmartFeatures } = useAccount();
  const people = usePeople();
  const toast = useToast();
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState<SmartFeaturesChoice['choice'] | null>(null);
  const open = state.status === 'unlocked' && needsSmartFeaturesAnswer(smartFeatures) && !later;

  const choose = (choice: SmartFeaturesChoice['choice']) => {
    if (busy) return;
    setBusy(choice);
    chooseSmartFeatures({ choice, version: SMART_FEATURES_VERSION })
      .then(
        () => {
          people.setEnabled(choice === 'on');
        },
        (caught: unknown) => {
          toast.show(errorMessage(caught));
        },
      )
      .finally(() => {
        setBusy(null);
      });
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        setLater(true);
      }}
      title="Smart features, on your device"
    >
      <div className="smart-features">
        <p>
          Arcafold can find the faces in your photos and group photos of the same person, so you can
          see everyone in a tap.
        </p>
        <ul className="smart-features__points">
          <li>
            It all happens on this device. Your photos and the faces in them never leave it
            unencrypted, and we can’t see them.
          </li>
          <li>You can turn it off anytime in Settings, on each of your devices.</li>
          <li>
            The first time, this device downloads some resources (about {MODEL_DOWNLOAD_MB} MB).
          </li>
        </ul>
      </div>
      <div className="dialog__actions">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={busy !== null}
          aria-busy={busy === 'off'}
          onClick={() => {
            choose('off');
          }}
        >
          Not now
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy !== null}
          aria-busy={busy === 'on'}
          onClick={() => {
            choose('on');
          }}
        >
          Turn on
        </button>
      </div>
    </Dialog>
  );
}
