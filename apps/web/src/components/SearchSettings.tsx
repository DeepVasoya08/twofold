import { useState } from 'react';

import { errorMessage } from '../app/account-ops';
import { useSearch } from '../app/search';
import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import { pluralize } from '../lib/format';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { SEARCH_DOWNLOAD_MB } from './SmartSearchCard';

/**
 * Smart search in Settings: on or off for this device, how far looking at photos has got,
 * and forgetting every search result in the open space.
 */
export function SearchSettings() {
  const search = useSearch();
  const { space } = useVault();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const where = space === 'private' ? 'private space' : 'library';
  const { done, total } = search.progress;

  const description = !search.enabled
    ? `Find photos by what’s in them, worked out on this device only. Downloads some resources (about ${String(SEARCH_DOWNLOAD_MB)} MB) the first time.`
    : search.phone
      ? 'On for this device. This phone looks at the photos it uploads; a computer does the rest. Nothing leaves your devices unencrypted.'
      : `On for this device. ${String(done)} of ${pluralize(total, 'photo')} ready to search. Photos are looked at here, never on our servers.`;

  const forget = () => {
    if (busy) return;
    setBusy(true);
    search
      .forget()
      .then(
        () => {
          toast.show('Search data deleted');
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
          <Icon name="sparkle" size={20} />
        </span>
        <div className="settings-row__text">
          <span className="settings-row__title">Smart search</span>
          <span className="settings-row__description">{description}</span>
        </div>
        <div className="settings-row__action">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            aria-pressed={search.enabled}
            onClick={() => {
              search.setEnabled(!search.enabled);
            }}
          >
            {search.enabled ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-row__icon">
          <Icon name="trash" size={20} />
        </span>
        <div className="settings-row__text">
          <span className="settings-row__title">Delete search data</span>
          <span className="settings-row__description">
            Forget what Smart search worked out about the photos in this {where}.
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
        title="Delete search data?"
        description={`What Smart search worked out about the photos in this ${where} is deleted, and Smart search turns off on this device. Your photos stay as they are.`}
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
            Delete search data
          </button>
        </div>
      </Dialog>
    </>
  );
}
