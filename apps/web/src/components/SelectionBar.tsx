import { useState } from 'react';

import type { SpaceKeys } from '@twofold/crypto';

import { useAccount } from '../app/account';
import { allSelected, batchMessage } from '../app/selection';
import type { Selection } from '../app/selection';
import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import { pluralize } from '../lib/format';
import type { Settled } from '../lib/settle-each';
import type { Album } from '../mock/data';
import { AlbumPicker } from './AlbumPicker';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { MoveSpaceDialog, moveLabel } from './MoveSpaceDialog';
import { ShareDialog } from './ShareDialog';

import './selection-bar.css';

type Open = 'album' | 'delete' | 'move' | 'share' | null;

/**
 * Actions for the selected photos, in a bar over the top of the page: add to an album (or
 * take out of the one being viewed), share copies, favorite, move to the other space, and
 * delete. After a change, only the photos it couldn't change stay selected.
 */
export function SelectionBar({
  selection,
  allIds,
  albumId,
}: {
  selection: Selection;
  /** Every photo on the page, for selecting them all. */
  allIds: readonly string[];
  /** The album being viewed, which offers taking photos out of it. */
  albumId?: string | undefined;
}) {
  const vault = useVault();
  const { otherSpaceOpen } = useAccount();
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  // What the share dialog decrypts, fixed when it opens.
  const [sharing, setSharing] = useState<readonly string[]>([]);
  const { space, state } = vault;

  if (!selection.selecting) return null;

  const photos = state.photos.filter((photo) => selection.selected.has(photo.id));
  const ids = photos.map((photo) => photo.id);
  const count = ids.length;
  const allFavorite = count > 0 && photos.every((photo) => photo.favorite);
  // Photos in a library shared with you stay in it.
  const movable = photos.filter((photo) => photo.library === undefined).map((photo) => photo.id);
  const album = albumId ? state.albums.find((each) => each.id === albumId) : undefined;

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
          toast.show(batchMessage({ done: [], failed: ids, error }, done));
        },
      )
      .finally(() => {
        setBusy(false);
        setOpen(null);
      });
  };

  const addTo = (target: Album) => {
    run(
      () => vault.setDetails(ids, { album: target, included: true }),
      (added) => `${added} added to “${target.title}”`,
    );
  };

  const move = (keys?: SpaceKeys) => {
    run(
      () => vault.movePhotos(movable, keys),
      (moved) => `${moved} moved to your ${space === 'private' ? 'library' : 'private space'}`,
    );
  };

  const actions: { label: string; icon: IconName; onClick: () => void; danger?: boolean }[] = [
    {
      label: 'Add to album',
      icon: 'album-add',
      onClick: () => {
        setOpen('album');
      },
    },
  ];
  if (album) {
    actions.push({
      label: 'Remove from album',
      icon: 'album-remove',
      onClick: () => {
        run(
          () => vault.setDetails(ids, { album, included: false }),
          (removed) => `${removed} removed from “${album.title}”`,
        );
      },
    });
  }
  actions.push(
    {
      label: 'Share',
      icon: 'share',
      onClick: () => {
        setSharing(ids);
        setOpen('share');
      },
    },
    {
      label: allFavorite ? 'Remove from favorites' : 'Add to favorites',
      icon: 'heart',
      onClick: () => {
        run(
          () => vault.setDetails(ids, { favorite: !allFavorite }),
          (changed) =>
            allFavorite ? `${changed} removed from favorites` : `${changed} added to favorites`,
        );
      },
    },
  );
  if (movable.length > 0) {
    actions.push({
      label: moveLabel(space),
      icon: space === 'private' ? 'photos' : 'eye-off',
      onClick: () => {
        if (otherSpaceOpen) move();
        else setOpen('move');
      },
    });
  }
  actions.push({
    label: 'Delete',
    icon: 'trash',
    danger: true,
    onClick: () => {
      setOpen('delete');
    },
  });

  const shared = photos.some((photo) => photo.library !== undefined);
  const everything = allSelected(selection.selected, allIds);
  return (
    <>
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
          {count === 0 ? 'Select photos' : `${pluralize(count, 'photo')} selected`}
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
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`selection-bar__btn${action.danger ? ' selection-bar__btn--danger' : ''}`}
              disabled={count === 0 || busy}
              onClick={action.onClick}
              aria-label={action.label}
              title={action.label}
            >
              <Icon name={action.icon} size={20} />
              <span className="selection-bar__label">{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      <AlbumPicker
        open={open === 'album'}
        photos={photos}
        except={albumId}
        busy={busy}
        onClose={() => {
          setOpen(null);
        }}
        onPick={addTo}
      />

      <MoveSpaceDialog
        open={open === 'move'}
        space={space}
        count={movable.length}
        busy={busy}
        onClose={() => {
          setOpen(null);
        }}
        onUnlocked={move}
      />

      <ShareDialog
        open={open === 'share'}
        photoIds={sharing}
        onClose={() => {
          setOpen(null);
        }}
      />

      <Dialog
        open={open === 'delete'}
        onClose={() => {
          setOpen(null);
        }}
        title={count === 1 ? 'Delete this photo?' : `Delete ${pluralize(count, 'photo')}?`}
        description={
          shared
            ? "They will be removed for everyone, including from libraries shared with you. This can't be undone."
            : space === 'private'
              ? "They will be removed from your private space, and for anyone you share it with. This can't be undone."
              : "They will be removed for everyone you share this library with. This can't be undone."
        }
      >
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setOpen(null);
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
                () => vault.deletePhotos(ids),
                (deleted) => `${deleted} deleted`,
              );
            }}
          >
            Delete
          </button>
        </div>
      </Dialog>
    </>
  );
}
