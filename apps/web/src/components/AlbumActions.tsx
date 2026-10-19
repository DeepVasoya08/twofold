import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { errorMessage } from '../app/account-ops';
import { Link } from '../app/router';
import { paths } from '../app/routes';
import { useToast } from '../app/toast';
import { albumPhotos, useVault } from '../app/vault';
import { pluralize } from '../lib/format';
import type { Album } from '../mock/data';
import { Dialog } from './Dialog';
import { TextField } from './Field';
import { Menu } from './Menu';
import { ShareDialog } from './ShareDialog';

type Open = 'rename' | 'share' | 'delete' | null;

/**
 * Rename, share or delete an album, from a "more" menu. Deleting an album keeps its photos.
 * Sharing sends copies of its photos; inviting someone shares the whole library, since
 * invites are per library, not per album.
 */
export function AlbumActions({
  album,
  className,
  onDeleted,
}: {
  album: Album;
  className?: string | undefined;
  onDeleted?: (() => void) | undefined;
}) {
  const { state, space, renameAlbum, deleteAlbum } = useVault();
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);
  const [title, setTitle] = useState(album.title);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // What the share dialog decrypts, fixed when it opens.
  const [sharing, setSharing] = useState<readonly string[]>([]);
  const count = albumPhotos(state, album.id).length;
  const inShared = album.library !== undefined;

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

  const onDelete = () => {
    if (busy) return;
    setBusy(true);
    deleteAlbum(album.id).then(
      () => {
        setBusy(false);
        close();
        toast.show(`“${album.title}” deleted`);
        onDeleted?.();
      },
      (caught: unknown) => {
        setBusy(false);
        close();
        toast.show(errorMessage(caught));
      },
    );
  };

  const where = inShared
    ? `${album.library ?? ''}’s library`
    : space === 'private'
      ? 'your private space'
      : 'your library';

  return (
    <>
      <Menu
        label={`Actions for ${album.title}`}
        className={className}
        items={[
          {
            label: 'Rename',
            icon: 'pencil',
            onSelect: () => {
              setTitle(album.title);
              setOpen('rename');
            },
          },
          {
            label: 'Share',
            icon: 'share',
            onSelect: () => {
              setSharing(albumPhotos(state, album.id).map((photo) => photo.id));
              setOpen('share');
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
        ]}
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

      <ShareDialog open={open === 'share'} photoIds={sharing} onClose={close}>
        {!inShared && (
          <section className="share-invite">
            <h3 className="share-invite__title">Share the album itself</h3>
            <p className="share-copies__note">
              Invites share all of {where}, not one album. Everyone you invite sees every photo and
              album in it, and what they add shows up for you.
            </p>
            <Link to={paths.share} className="btn btn--secondary">
              Invite someone
            </Link>
          </section>
        )}
      </ShareDialog>

      <Dialog
        open={open === 'delete'}
        onClose={close}
        title={`Delete “${album.title}”?`}
        description={
          count === 0
            ? 'The album will be removed for everyone who can see it.'
            : `The album will be removed for everyone who can see it. ${count === 1 ? 'Its photo stays' : `Its ${pluralize(count, 'photo')} stay`} in ${where}.`
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
    </>
  );
}
