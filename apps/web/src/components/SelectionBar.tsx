import { useState } from 'react';

import type { SpaceKeys } from '@arcafold/crypto';

import { useAccount } from '../app/account';
import { useDownloads } from '../app/downloads';
import { useRouter } from '../app/router';
import { useSearch } from '../app/search';
import { paths } from '../app/routes';
import { allSelected, batchMessage } from '../app/selection';
import type { Selection } from '../app/selection';
import { useToast } from '../app/toast';
import { addsByUpload, isViewOnly, trashNote, useVault } from '../app/vault';
import { pluralize } from '../lib/format';
import type { Settled } from '../lib/settle-each';
import { AlbumPicker } from './AlbumPicker';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { MoveSpaceDialog, moveLabel } from './MoveSpaceDialog';
import { TeachWordDialog } from './TeachWordDialog';
import { errorMessage } from '@arcafold/core/errors';
import type { Album } from '@arcafold/core/library/model';

import './selection-bar.css';

type Open = 'album' | 'delete' | 'move' | 'share' | 'teach' | null;

interface Action {
  label: string;
  icon: IconName;
  onClick: () => void;
  danger?: boolean;
}

/** An action a page adds to the bar: what it runs, and what to say once it's done. */
export interface ExtraAction {
  label: string;
  icon: IconName;
  run: (photoIds: readonly string[]) => Promise<Settled<string>>;
  done: (photos: string) => string;
}

/**
 * Actions for the selected photos, in a bar over the top of the page: add to an album (or
 * take out of the one being viewed), share with someone, download, teach search a word,
 * favorite, move to the other space, and delete. Photos from an album someone shared with
 * you can only be downloaded, or taught. After a change, only the photos it couldn't change stay selected.
 */
export function SelectionBar({
  selection,
  allIds,
  albumId,
  extra,
}: {
  selection: Selection;
  /** Every photo on the page, for selecting them all. */
  allIds: readonly string[];
  /** The album being viewed, which offers taking photos out of it. */
  albumId?: string | undefined;
  /**
   * One more action for this page, offered for any photos (it changes nothing in them), such
   * as saying photos aren't of the person being viewed.
   */
  extra?: ExtraAction | undefined;
}) {
  const vault = useVault();
  const downloads = useDownloads();
  const { otherSpaceOpen } = useAccount();
  const smartSearch = useSearch();
  const { navigate } = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);
  // What's being done to the photos right now, shown in the bar even once its dialog closes.
  const [working, setWorking] = useState<string | null>(null);
  const busy = working !== null;
  // What the share dialog works on, fixed when it opens.
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const { space, state } = vault;

  if (!selection.selecting) return null;

  const photos = state.photos.filter((photo) => selection.selected.has(photo.id));
  const ids = photos.map((photo) => photo.id);
  const count = ids.length;
  const allFavorite = count > 0 && photos.every((photo) => photo.favorite);
  // Photos in a library shared with you stay in it.
  const movable = photos.filter((photo) => photo.library === undefined).map((photo) => photo.id);
  const album = albumId ? state.albums.find((each) => each.id === albumId) : undefined;
  // Only your own photos can be shared, through an album of your own.
  const shareable = count > 0 && photos.every((photo) => photo.library === undefined);
  const viewOnly = photos.some(isViewOnly);

  const run = (
    doing: string,
    change: () => Promise<Settled<string>>,
    done: (photos: string) => string,
    undo?: (photoIds: readonly string[]) => Promise<unknown>,
  ) => {
    if (busy) return;
    setWorking(doing);
    change()
      .then(
        (result) => {
          const changed = result.done;
          toast.show(
            batchMessage(result, done),
            undo && changed.length > 0
              ? {
                  label: 'Undo',
                  run: () => {
                    undo(changed).catch((error: unknown) => {
                      toast.show(errorMessage(error));
                    });
                  },
                }
              : undefined,
          );
          selection.replace(result.failed);
        },
        (error: unknown) => {
          toast.show(batchMessage({ done: [], failed: ids, error }, done));
        },
      )
      .finally(() => {
        setWorking(null);
        setOpen(null);
      });
  };

  const addTo = (target: Album) => {
    run(
      `Adding ${pluralize(count, 'photo')} to “${target.title}”…`,
      () => vault.setDetails(ids, { album: target, included: true }),
      (added) => `${added} added to “${target.title}”`,
    );
  };

  const move = (keys?: SpaceKeys) => {
    run(
      `Moving ${pluralize(movable.length, 'photo')} to your ${space === 'private' ? 'library' : 'private space'}…`,
      () => vault.movePhotos(movable, keys),
      (moved) => `${moved} moved to your ${space === 'private' ? 'library' : 'private space'}`,
    );
  };

  /**
   * Shares the photos through `target`: puts them in it (if they aren't already), then opens
   * the invite for that album. Everyone invited to an album sees the same album.
   */
  const shareThrough = (target: Album) => {
    if (busy) return;
    setWorking(`Adding ${pluralize(chosen.length, 'photo')} to “${target.title}”…`);
    vault
      .setDetails(chosen, { album: target, included: true })
      .then((result) => {
        if (result.failed.length > 0) {
          toast.show(batchMessage(result, (added) => `${added} added to “${target.title}”`));
          return;
        }
        selection.clear();
        setOpen(null);
        navigate(paths.shareAlbum(target.id));
      })
      .catch((error: unknown) => {
        toast.show(errorMessage(error));
      })
      .finally(() => {
        setWorking(null);
      });
  };

  const download: Action = {
    label: 'Download',
    icon: 'download',
    onClick: () => {
      downloads.start(ids);
    },
  };

  // Teaching changes nothing in the photos, so it's offered for any of them.
  const teach: Action[] = smartSearch.enabled
    ? [
        {
          label: 'Teach a word',
          icon: 'sparkle',
          onClick: () => {
            setChosen(ids);
            setOpen('teach');
          },
        },
      ]
    : [];

  const actions: Action[] = [
    {
      label: 'Add to album',
      icon: 'album-add',
      onClick: () => {
        setOpen('album');
      },
    },
  ];
  const removeFromAlbum: Action[] = album
    ? [
        {
          label: 'Remove from album',
          icon: 'album-remove',
          onClick: () => {
            run(
              `Removing ${pluralize(count, 'photo')} from “${album.title}”…`,
              () => vault.setDetails(ids, { album, included: false }),
              (removed) => `${removed} removed from “${album.title}”`,
            );
          },
        },
      ]
    : [];
  actions.push(...removeFromAlbum);
  if (shareable) {
    actions.push({
      label: 'Share',
      icon: 'share',
      onClick: () => {
        // Inside one of your albums, the photos are already in it: share that album.
        if (album && album.library === undefined) {
          selection.clear();
          navigate(paths.shareAlbum(album.id));
          return;
        }
        setChosen(ids);
        setOpen('share');
      },
    });
  }
  actions.push(download, ...teach, {
    label: allFavorite ? 'Remove from favorites' : 'Add to favorites',
    icon: 'heart',
    onClick: () => {
      run(
        allFavorite ? 'Removing from favorites…' : 'Adding to favorites…',
        () => vault.setDetails(ids, { favorite: !allFavorite }),
        (changed) =>
          allFavorite ? `${changed} removed from favorites` : `${changed} added to favorites`,
      );
    },
  });
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

  const pageActions: Action[] = extra
    ? [
        {
          label: extra.label,
          icon: extra.icon,
          onClick: () => {
            run('Saving…', () => extra.run(ids), extra.done);
          },
        },
      ]
    : [];
  // In an album shared with you that you may add to, photos can still be taken out of it.
  const viewing = album && addsByUpload(album) ? [...removeFromAlbum, download] : [download];
  const shown = viewOnly ? [...pageActions, ...viewing, ...teach] : [...pageActions, ...actions];
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
          {working !== null ? (
            <>
              <span className="selection-bar__spinner" aria-hidden="true" />
              {working}
            </>
          ) : count === 0 ? (
            'Select photos'
          ) : (
            `${pluralize(count, 'photo')} selected`
          )}
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
          {shown.map((action) => (
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

      <AlbumPicker
        open={open === 'share'}
        photos={photos.filter((photo) => chosen.includes(photo.id))}
        busy={busy}
        sharing
        onClose={() => {
          setOpen(null);
        }}
        onPick={shareThrough}
      />

      <TeachWordDialog
        open={open === 'teach'}
        photoIds={chosen}
        onClose={() => {
          setOpen(null);
        }}
        onTaught={() => {
          setOpen(null);
          selection.clear();
        }}
      />

      <Dialog
        open={open === 'delete'}
        onClose={() => {
          setOpen(null);
        }}
        title={count === 1 ? 'Delete this photo?' : `Delete ${pluralize(count, 'photo')}?`}
        description={`${
          shared
            ? 'They will be removed for everyone, including from libraries shared with you.'
            : space === 'private'
              ? 'They will be removed from your private space, and for anyone you share it with.'
              : 'They will be removed for everyone you share this library with.'
        } ${trashNote(count)}`}
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
                `Deleting ${pluralize(count, 'photo')}…`,
                () => vault.deletePhotos(ids),
                (deleted) => `${deleted} moved to Recently deleted`,
                (deleted) => vault.restorePhotos(deleted),
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
