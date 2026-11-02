import { useState } from 'react';

import { errorMessage } from '../app/account-ops';
import { allSelected, batchMessage, useSelection } from '../app/selection';
import { useToast } from '../app/toast';
import { TRASH_DAYS, trashDaysLeft, useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { PhotoGrid } from '../components/PhotoGrid';
import { photosAndFiles } from '../lib/format';
import type { Settled } from '../lib/settle-each';
import type { Photo } from '../mock/data';

import '../components/selection-bar.css';

/** "12 days left", "1 day left", or "Today" on the last day. */
export function daysLeftLabel(photo: Pick<Photo, 'deletedAt'>, now = Date.now()): string {
  if (photo.deletedAt === undefined) return '';
  const days = trashDaysLeft(photo.deletedAt, now);
  return days <= 1 ? 'Last day' : `${String(days)} days left`;
}

/**
 * Photos deleted in the last 30 days. They can be restored, or deleted for good now; after
 * 30 days a device that opens the space deletes them for good.
 */
export function RecentlyDeleted() {
  const { state, restorePhotos, deleteForever } = useVault();
  const toast = useToast();
  const selection = useSelection();
  const [confirm, setConfirm] = useState<'selected' | 'all' | null>(null);
  const [busy, setBusy] = useState(false);
  const trash = state.trash ?? [];
  const allIds = trash.map((photo) => photo.id);
  const selected = allIds.filter((photoId) => selection.selected.has(photoId));
  const everything = allSelected(selection.selected, allIds);
  // Picking is how this page works: a tap selects a photo rather than opening it.
  const picking = { ...selection, selecting: true };

  const run = (change: () => Promise<Settled<string>>, done: (photos: string) => string) => {
    if (busy) return;
    setBusy(true);
    change()
      .then(
        (result) => {
          toast.show(batchMessage(result, done));
          selection.replace(result.failed);
        },
        (error: unknown) => {
          toast.show(errorMessage(error));
        },
      )
      .finally(() => {
        setBusy(false);
        setConfirm(null);
      });
  };

  const forever = confirm === 'all' ? allIds : selected;

  return (
    <div className="page">
      <PageHeader
        title="Recently deleted"
        subtitle={`Photos and files stay here for ${String(TRASH_DAYS)} days, then they’re deleted for good.`}
        actions={
          trash.length > 0 && (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => {
                setConfirm('all');
              }}
            >
              <Icon name="trash" size={18} />
              Empty
            </button>
          )
        }
      />

      {selected.length > 0 && (
        <div className="selection-bar" role="toolbar" aria-label="Selected photos">
          <button
            type="button"
            className="icon-btn"
            onClick={selection.clear}
            aria-label="Cancel selection"
          >
            <Icon name="x" />
          </button>
          <span className="selection-bar__count" aria-live="polite">
            {photosAndFiles(trash.filter((photo) => selection.selected.has(photo.id)))} selected
          </span>
          <button
            type="button"
            className="selection-bar__all"
            onClick={() => {
              if (everything) selection.replace([]);
              else selection.setMany(allIds, true);
            }}
          >
            {everything ? 'Deselect all' : 'Select all'}
          </button>
          <div className="selection-bar__actions">
            <button
              type="button"
              className="selection-bar__btn"
              title="Restore"
              disabled={busy}
              onClick={() => {
                run(
                  () => restorePhotos(selected),
                  (photos) => `${photos} restored`,
                );
              }}
            >
              <Icon name="restore" size={20} />
              <span className="selection-bar__label">Restore</span>
            </button>
            <button
              type="button"
              className="selection-bar__btn selection-bar__btn--danger"
              title="Delete now"
              disabled={busy}
              onClick={() => {
                setConfirm('selected');
              }}
            >
              <Icon name="trash" size={20} />
              <span className="selection-bar__label">Delete now</span>
            </button>
          </div>
        </div>
      )}

      {trash.length === 0 ? (
        <EmptyState icon="trash" title="Nothing here">
          {state.trash === undefined
            ? 'Loading…'
            : `Photos and files you delete stay here for ${String(TRASH_DAYS)} days, so you can get them back.`}
        </EmptyState>
      ) : (
        <PhotoGrid
          photos={trash}
          context={{ kind: 'all' }}
          selection={picking}
          note={(photo) => daysLeftLabel(photo)}
        />
      )}

      <Dialog
        open={confirm !== null}
        onClose={() => {
          setConfirm(null);
        }}
        title={
          confirm === 'all'
            ? 'Empty Recently deleted?'
            : `Delete ${photosAndFiles(trash.filter((photo) => forever.includes(photo.id)))} for good?`
        }
        description="They’ll be deleted for everyone, with their files. This can’t be undone."
      >
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setConfirm(null);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              run(
                () => deleteForever(forever),
                (photos) => `${photos} deleted for good`,
              );
            }}
          >
            Delete for good
          </button>
        </div>
      </Dialog>
    </div>
  );
}
