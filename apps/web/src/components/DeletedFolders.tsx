import { useState } from 'react';

import { useToast } from '../app/toast';
import { foldersOf, useVault } from '../app/vault';
import { errorMessage } from '@arcafold/core/errors';
import { folderRestore } from '@arcafold/core/library/folders';
import type { Folder } from '@arcafold/core/library/model';
import { daysLeftLabel } from '@arcafold/core/library/trash';
import { Dialog } from './Dialog';
import { folderSummary } from './FolderTile';
import { Icon } from './Icon';

import './folders.css';

/**
 * Folders in Recently deleted, each with what was deleted along with it. Restoring one brings
 * that back too, into the folder; deleting it for good deletes that too.
 */
export function DeletedFolders({ folders }: { folders: readonly Folder[] }) {
  const { state, restoreFolder, deleteFolderForever } = useVault();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Folder | null>(null);
  const all = foldersOf(state);
  const trash = state.trash ?? [];

  const run = (work: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(true);
    work()
      .then(
        () => {
          toast.show(done);
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

  return (
    <section className="deleted-folders" aria-labelledby="deleted-folders-title">
      <h2 className="folders__title" id="deleted-folders-title">
        Folders
      </h2>
      <ul className="deleted-folders__list">
        {folders.map((folder) => {
          const inside = folderRestore(all, trash, folder.id);
          const parts = [
            folderSummary({ items: inside.itemIds.length, folders: inside.folderIds.length - 1 }),
            daysLeftLabel(folder),
          ];
          return (
            <li key={folder.id} className="deleted-folder">
              <span className="folder-picker__icon" aria-hidden="true" />
              <span className="deleted-folder__text">
                <span className="deleted-folder__name">{folder.name}</span>
                <span className="deleted-folder__meta">{parts.join(' · ')}</span>
              </span>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={busy}
                onClick={() => {
                  run(() => restoreFolder(folder.id), `“${folder.name}” restored`);
                }}
              >
                <Icon name="restore" size={16} />
                Restore
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={busy}
                aria-label={`Delete ${folder.name} for good`}
                onClick={() => {
                  setConfirm(folder);
                }}
              >
                <Icon name="trash" size={16} />
              </button>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={confirm !== null}
        onClose={() => {
          setConfirm(null);
        }}
        title={`Delete “${confirm?.name ?? ''}” for good?`}
        description="The folder and everything deleted with it will be gone for good. This can’t be undone."
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
              if (confirm) {
                run(() => deleteFolderForever(confirm.id), `“${confirm.name}” deleted for good`);
              }
            }}
          >
            Delete for good
          </button>
        </div>
      </Dialog>
    </section>
  );
}
