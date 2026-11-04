import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { useAccount } from '../app/account';
import { useDownloads } from '../app/downloads';
import { leaveJoined } from '@arcafold/core/sharing';
import { useToast } from '../app/toast';
import { albumFiles, albumPhotos, useVault } from '../app/vault';
import { photosAndFiles } from '../lib/format';
import { AlbumShareDialog } from './AlbumShareDialog';
import { Dialog } from './Dialog';
import { TextField } from './Field';
import { Menu } from './Menu';
import type { MenuItem } from './Menu';
import { errorMessage } from '@arcafold/core/errors';
import type { Album } from '@arcafold/core/library/model';

type Open = 'rename' | 'share' | 'delete' | 'leave' | null;

/**
 * An album's actions, from a "more" menu. Your own albums can be shared with people,
 * downloaded, renamed or deleted (deleting keeps the photos). Albums in a library shared with
 * you can be downloaded, renamed or deleted, and an album someone shared with you can be
 * downloaded or left.
 */
export function AlbumActions({
  album,
  className,
  onGone,
}: {
  album: Album;
  className?: string | undefined;
  /** After the album is deleted or left, so a page showing it can move on. */
  onGone?: (() => void) | undefined;
}) {
  const { state, space, renameAlbum, deleteAlbum } = useVault();
  const account = useAccount();
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);
  const [title, setTitle] = useState(album.title);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const downloads = useDownloads();
  const inside = [...albumPhotos(state, album.id), ...albumFiles(state, album.id)];
  const count = inside.length;
  const inShared = album.library !== undefined;
  const keys = account.state.status === 'unlocked' ? account.state.session.opened.space : null;

  const close = () => {
    setOpen(null);
    setError(null);
  };

  const onRename = (event: SubmitEvent) => {
    event.preventDefault();
    const name = title.trim();
    if (!name) {
      setError('Give your album a name.');
      return;
    }
    if (busy) return;
    if (name === album.title) {
      close();
      return;
    }
    setBusy(true);
    renameAlbum(album.id, name)
      .then(
        () => {
          toast.show(`Renamed to “${name}”`);
          close();
        },
        (caught: unknown) => {
          setError(errorMessage(caught));
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };

  /** Runs a change that ends with the album gone from here, then tells the page. */
  const finish = (change: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(true);
    change().then(
      () => {
        setBusy(false);
        close();
        toast.show(done);
        onGone?.();
      },
      (caught: unknown) => {
        setBusy(false);
        close();
        toast.show(errorMessage(caught));
      },
    );
  };

  const onDelete = () => {
    finish(() => deleteAlbum(album.id), `“${album.title}” deleted`);
  };

  const onLeave = () => {
    const joinedId = album.joinedId;
    if (!keys || !joinedId) return;
    finish(async () => {
      await leaveJoined(keys, joinedId);
      // Its photos leave the open space too.
      account.reloadVault();
    }, `You left “${album.title}”`);
  };

  const where = inShared
    ? `${album.library ?? ''}’s library`
    : space === 'private'
      ? 'your private space'
      : 'your library';

  const download: MenuItem = {
    label: 'Download',
    icon: 'download',
    onSelect: () => {
      downloads.start(inside.map((item) => item.id));
    },
  };
  const items: MenuItem[] =
    album.viewOnly && !album.sharedAlbum
      ? // An album in a library you can only view: leaving is for the whole library, in Settings.
        [download]
      : album.sharedAlbum
        ? [
            download,
            {
              label: 'Leave album',
              icon: 'logout',
              danger: true,
              onSelect: () => {
                setOpen('leave');
              },
            },
          ]
        : [
            // Only a space's owner says who it's shared with, so only your own albums are shared.
            ...(inShared
              ? []
              : [
                  {
                    label: 'Share',
                    icon: 'share',
                    onSelect: () => {
                      setOpen('share');
                    },
                  } satisfies MenuItem,
                ]),
            download,
            {
              label: 'Rename',
              icon: 'pencil',
              onSelect: () => {
                setTitle(album.title);
                setOpen('rename');
              },
            },
            {
              label: 'Delete album',
              icon: 'trash',
              danger: true,
              onSelect: () => {
                setOpen('delete');
              },
            },
          ];

  return (
    <>
      <Menu
        label={`Actions for ${album.title}`}
        className={className}
        icon="more-vertical"
        items={items}
      />

      <Dialog open={open === 'rename'} onClose={close} title="Rename album">
        <form className="form" onSubmit={onRename} noValidate>
          <TextField
            label="Album name"
            autoFocus
            value={title}
            maxLength={80}
            onChange={(event) => {
              setTitle(event.currentTarget.value);
              setError(null);
            }}
            error={error}
          />
          <div className="dialog__actions">
            <button type="button" className="btn btn--ghost" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
              Save
            </button>
          </div>
        </form>
      </Dialog>

      {!inShared && <AlbumShareDialog open={open === 'share'} album={album} onClose={close} />}

      <Dialog
        open={open === 'delete'}
        onClose={close}
        title={`Delete “${album.title}”?`}
        description={
          count === 0
            ? 'The album will be removed for everyone who can see it.'
            : `The album will be removed for everyone who can see it. ${count === 1 ? `Its ${inside[0]?.file ? 'file' : 'photo'} stays` : `Its ${photosAndFiles(inside)} stay`} in ${where}.`
        }
      >
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={onDelete}
            disabled={busy}
            aria-busy={busy}
          >
            Delete album
          </button>
        </div>
      </Dialog>

      <Dialog
        open={open === 'leave'}
        onClose={close}
        title={`Leave “${album.title}”?`}
        description={`You won’t see it anymore. ${album.library ?? 'Its owner'} can invite you again.`}
      >
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={onLeave}
            disabled={busy}
            aria-busy={busy}
          >
            Leave album
          </button>
        </div>
      </Dialog>
    </>
  );
}
