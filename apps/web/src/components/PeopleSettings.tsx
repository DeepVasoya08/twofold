import { useState } from 'react';

import { usePeople } from '../app/people';
import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import { MODEL_DOWNLOAD_MB } from '../lib/people/models';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { errorMessage } from '@arcafold/core/errors';

/**
 * Face grouping in Settings: on or off for this device, and forgetting every face and name
 * in the open space.
 */
export function PeopleSettings() {
  const people = usePeople();
  const { space } = useVault();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const where = space === 'private' ? 'private space' : 'library';

  const forget = () => {
    if (busy) return;
    setBusy(true);
    people
      .forget()
      .then(
        () => {
          toast.show('Face data deleted');
          setConfirming(false);
        },
        (caught: unknown) => {
          toast.show(errorMessage(caught));
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      <div className="settings-row">
        <span className="settings-row__icon">
          <Icon name="person" size={20} />
        </span>
        <div className="settings-row__text">
          <span className="settings-row__title">Face grouping</span>
          <span className="settings-row__description">
            {people.enabled
              ? 'On for this device. Faces are found and grouped here, never on our servers.'
              : `Group photos by the people in them, found on this device only. Downloads some resources (about ${String(MODEL_DOWNLOAD_MB)} MB) the first time.`}
          </span>
        </div>
        <div className="settings-row__action">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            aria-pressed={people.enabled}
            onClick={() => {
              people.setEnabled(!people.enabled);
            }}
          >
            {people.enabled ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-row__icon">
          <Icon name="trash" size={20} />
        </span>
        <div className="settings-row__text">
          <span className="settings-row__title">Delete face data</span>
          <span className="settings-row__description">
            Forget every face and name found in this {where}.
          </span>
        </div>
        <div className="settings-row__action">
          <button
            type="button"
            className="btn btn--danger-ghost btn--sm"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Delete
          </button>
        </div>
      </div>
      <Dialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        title="Delete face data?"
        description={`Every face and name found in this ${where} is deleted, and face grouping turns off on this device. Your photos stay as they are.`}
      >
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setConfirming(false);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            aria-busy={busy}
            onClick={forget}
          >
            Delete face data
          </button>
        </div>
      </Dialog>
    </>
  );
}
