import { useState } from 'react';

import { useSearch } from '../app/search';
import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import { useDocumentPhotosView } from '../app/views';
import { pluralize } from '../lib/format';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { Switch } from './Switch';
import { SEARCH_DOWNLOAD_MB } from './SmartSearchCard';
import { errorMessage } from '@arcafold/core/errors';

/**
 * Smart search in Settings: on or off for this device, how far looking at photos has got,
 * the words taught to search, and forgetting every search result in the open space.
 */
export function SearchSettings() {
  const search = useSearch();
  const { space } = useVault();
  const toast = useToast();
  const [documents, setDocuments] = useDocumentPhotosView();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [forgetting, setForgetting] = useState<string | null>(null);
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

  const forgetWord = (id: string, name: string) => {
    if (forgetting) return;
    setForgetting(id);
    search
      .forgetWord(id)
      .then(
        () => {
          toast.show(`Search forgot “${name}”`);
        },
        (caught: unknown) => {
          toast.show(errorMessage(caught));
        },
      )
      .finally(() => {
        setForgetting(null);
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
          <Switch label="Smart search" checked={search.enabled} onChange={search.setEnabled} />
        </div>
      </div>
      {search.enabled && (
        <div className="settings-row">
          <span className="settings-row__icon">
            <Icon name="file" size={20} />
          </span>
          <div className="settings-row__text">
            <span className="settings-row__title">Hide document photos from Photos</span>
            <span className="settings-row__description">
              {documents === 'hide'
                ? 'On for this device. Photos of receipts, documents, screenshots and notes show only in Files.'
                : 'Photos of receipts, documents, screenshots and notes show in Photos and in Files.'}
            </span>
          </div>
          <div className="settings-row__action">
            <Switch
              label="Hide document photos from Photos"
              checked={documents === 'hide'}
              onChange={(hide) => {
                setDocuments(hide ? 'hide' : 'show');
              }}
            />
          </div>
        </div>
      )}
      {search.enabled &&
        search.words.map((word) => (
          <div className="settings-row" key={word.id}>
            <span className="settings-row__icon">
              <Icon name="search" size={20} />
            </span>
            <div className="settings-row__text">
              <span className="settings-row__title">{word.name}</span>
              <span className="settings-row__description">
                A word you taught search, with {pluralize(word.photos.length, 'photo')}.
              </span>
            </div>
            <div className="settings-row__action">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                aria-label={`Forget “${word.name}”`}
                disabled={forgetting !== null}
                aria-busy={forgetting === word.id}
                onClick={() => {
                  forgetWord(word.id, word.name);
                }}
              >
                Forget
              </button>
            </div>
          </div>
        ))}
      <div className="settings-row">
        <span className="settings-row__icon">
          <Icon name="trash" size={20} />
        </span>
        <div className="settings-row__text">
          <span className="settings-row__title">Delete search data</span>
          <span className="settings-row__description">
            Forget what Smart search worked out about the photos in this {where}, and the words you
            taught it.
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
        description={`What Smart search worked out about the photos in this ${where}, and the words you taught it, are deleted, and Smart search turns off on this device. Your photos stay as they are.`}
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
