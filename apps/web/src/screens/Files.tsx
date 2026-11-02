import { useMemo, useState } from 'react';

import type { SpaceKeys } from '@arcafold/crypto';

import { useAccount } from '../app/account';
import { errorMessage } from '../app/account-ops';
import { useDownloads } from '../app/downloads';
import { useToast } from '../app/toast';
import { useUploads } from '../app/uploads';
import { isViewOnly, trashNote, useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { FileIcon } from '../components/FileIcon';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Menu';
import type { MenuItem } from '../components/Menu';
import { MoveSpaceDialog, moveLabel } from '../components/MoveSpaceDialog';
import { fileKindLabel, fileKindOf } from '../lib/file-types';
import { formatShortDay, pluralize } from '../lib/format';
import { formatBytes } from '../lib/storage-usage';
import type { Photo } from '../mock/data';

import './files.css';

/** A file's details line: "PDF · 1.2 MB · 2 Nov", with whose library it's from. */
function detailsOf(item: Photo): string {
  const file = item.file;
  const parts = [
    file ? fileKindLabel(fileKindOf(file.type, file.name)) : 'File',
    ...(file?.bytes === undefined ? [] : [formatBytes(file.bytes)]),
    formatShortDay(item.takenAt),
    ...(item.library === undefined ? [] : [`Shared by ${item.library}`]),
  ];
  return parts.join(' · ');
}

/**
 * Files that aren't photos: PDFs, documents and anything else but videos. Encrypted on this
 * device like photos, and never opened inside the app for now; download one to open it.
 */
export function Files() {
  const vault = useVault();
  const { state, space } = vault;
  const { openDialog } = useUploads();
  const downloads = useDownloads();
  const { otherSpaceOpen } = useAccount();
  const toast = useToast();
  const [deleting, setDeleting] = useState<Photo | null>(null);
  const [moving, setMoving] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);

  const files = useMemo(
    () =>
      [...(state.files ?? [])]
        .filter((item) => !item.sharedAlbum)
        .sort((a, b) => b.takenAt.localeCompare(a.takenAt)),
    [state.files],
  );
  const total = files.reduce((sum, item) => sum + (item.size ?? 0), 0);

  const run = (work: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(true);
    work().then(
      () => {
        setBusy(false);
        setDeleting(null);
        setMoving(null);
        toast.show(done);
      },
      (error: unknown) => {
        setBusy(false);
        toast.show(errorMessage(error));
      },
    );
  };

  const move = (item: Photo, keys?: SpaceKeys) => {
    run(
      () => vault.movePhoto(item.id, keys),
      `Moved to your ${space === 'private' ? 'library' : 'private space'}`,
    );
  };

  const menuFor = (item: Photo): MenuItem[] => {
    const items: MenuItem[] = [
      {
        label: 'Download',
        icon: 'download',
        onSelect: () => {
          downloads.start([item.id]);
        },
      },
    ];
    if (isViewOnly(item)) return items;
    if (item.library === undefined) {
      items.push({
        label: moveLabel(space),
        icon: 'eye-off',
        onSelect: () => {
          if (otherSpaceOpen) move(item);
          else setMoving(item);
        },
      });
    }
    items.push({
      label: 'Delete',
      icon: 'trash',
      danger: true,
      onSelect: () => {
        setDeleting(item);
      },
    });
    return items;
  };

  const upload = (
    <button type="button" className="btn btn--primary" onClick={openDialog}>
      <Icon name="upload" size={18} />
      Add files
    </button>
  );

  return (
    <div className="page">
      <PageHeader
        title="Files"
        subtitle={
          files.length > 0
            ? `${pluralize(files.length, 'file')} · ${formatBytes(total)}`
            : 'PDFs, documents and other files, encrypted like your photos'
        }
        actions={files.length > 0 && upload}
      />

      {files.length === 0 ? (
        <EmptyState icon="file" title="No files yet" action={upload}>
          Add PDFs, documents, spreadsheets and other files. They’re encrypted on this device before
          they’re uploaded. Videos can’t be added yet.
        </EmptyState>
      ) : (
        <ul className="file-list" aria-label="Files">
          {files.map((item) => {
            const name = item.file?.name ?? 'File';
            return (
              <li key={item.id} className="file-row">
                <button
                  type="button"
                  className="file-row__main"
                  onClick={() => {
                    downloads.start([item.id]);
                  }}
                  aria-label={`Download ${name}`}
                >
                  {item.file && <FileIcon file={item.file} />}
                  <span className="file-row__text">
                    <span className="file-row__name">{name}</span>
                    <span className="file-row__meta">{detailsOf(item)}</span>
                  </span>
                </button>
                <Menu
                  label={`More for ${name}`}
                  items={menuFor(item)}
                  className="file-row__menu"
                  icon="more-vertical"
                />
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={deleting !== null}
        onClose={() => {
          setDeleting(null);
        }}
        title={`Delete ${deleting?.file?.name ?? 'this file'}?`}
        description={trashNote(1)}
      >
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setDeleting(null);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={() => {
              if (deleting) run(() => vault.deletePhoto(deleting.id), 'File deleted');
            }}
          >
            Delete
          </button>
        </div>
      </Dialog>

      <MoveSpaceDialog
        open={moving !== null}
        space={space}
        count={1}
        noun="file"
        busy={busy}
        onClose={() => {
          setMoving(null);
        }}
        onUnlocked={(keys) => {
          if (moving) move(moving, keys);
        }}
      />
    </div>
  );
}
