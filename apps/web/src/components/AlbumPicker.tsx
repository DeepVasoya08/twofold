import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { errorMessage } from '../app/account-ops';
import { albumCover, albumPhotos, fitsAlbum, useVault } from '../app/vault';
import { pluralize } from '../lib/format';
import type { Album, Photo } from '../mock/data';
import { Dialog } from './Dialog';
import { TextField } from './Field';
import { Icon } from './Icon';
import { PhotoImage } from './PhotoImage';

import './album-picker.css';

/** Albums at least one of `photos` can go in, leaving out `except` (the album being viewed). */
export function albumChoices(
  albums: readonly Album[],
  photos: readonly Photo[],
  except?: string,
): Album[] {
  return albums.filter(
    (album) => album.id !== except && photos.some((photo) => fitsAlbum(photo, album)),
  );
}

/**
 * The albums photos can be shared through: your own, the ones already shared with someone
 * first, so sharing more photos with the same people doesn't make another album.
 */
export function shareChoices(albums: readonly Album[], photos: readonly Photo[]): Album[] {
  const own = albumChoices(albums, photos).filter((album) => album.library === undefined);
  const shared = (album: Album) => ((album.sharedWith?.length ?? 0) > 0 ? 0 : 1);
  return [...own].sort((a, b) => shared(a) - shared(b));
}

/**
 * Picks an album to add photos to, or makes a new one. Albums belong to one library, so a
 * library shared with you only offers its own albums, and new albums are made in yours.
 * With `sharing`, it picks the album to share the photos through: only your own albums,
 * the ones already shared listed first.
 */
export function AlbumPicker({
  open,
  photos,
  except,
  busy,
  sharing = false,
  onClose,
  onPick,
}: {
  open: boolean;
  photos: readonly Photo[];
  except?: string | undefined;
  busy: boolean;
  sharing?: boolean;
  onClose: () => void;
  onPick: (album: Album) => void;
}) {
  const { state, createAlbum } = useVault();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const choices = sharing
    ? shareChoices(state.albums, photos)
    : albumChoices(state.albums, photos, except);
  const canCreate = photos.some((photo) => photo.library === undefined);

  const close = () => {
    setTitle('');
    setError(null);
    onClose();
  };

  const onCreate = (event: SubmitEvent) => {
    event.preventDefault();
    const name = title.trim();
    if (!name) {
      setError('Give your album a name.');
      return;
    }
    if (creating || busy) return;
    setCreating(true);
    createAlbum(name)
      .then(
        (album) => {
          setTitle('');
          onPick(album);
        },
        (caught: unknown) => {
          setError(errorMessage(caught));
        },
      )
      .finally(() => {
        setCreating(false);
      });
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={
        sharing
          ? `Share ${pluralize(photos.length, 'photo')}`
          : `Add ${pluralize(photos.length, 'photo')} to an album`
      }
      description={
        sharing
          ? 'Photos are shared through an album. Add them to one you already share, or to any album of yours, then invite people to it. Everyone invited sees the same album.'
          : undefined
      }
      size="md"
    >
      {choices.length > 0 ? (
        <ul className="album-picker" aria-label="Albums">
          {choices.map((album) => {
            const cover = albumCover(state, album);
            const count = albumPhotos(state, album.id).length;
            return (
              <li key={album.id}>
                <button
                  type="button"
                  className="album-picker__item"
                  disabled={busy || creating}
                  onClick={() => {
                    onPick(album);
                  }}
                >
                  <span className="album-picker__cover">
                    {cover ? (
                      <PhotoImage photoId={cover.id} src={cover.src} alt="" loading="lazy" />
                    ) : (
                      <Icon name="albums" size={20} />
                    )}
                  </span>
                  <span className="album-picker__text">
                    <span className="album-picker__title">{album.title}</span>
                    <span className="album-picker__meta">
                      {count === 0 ? 'Empty' : pluralize(count, 'photo')}
                      {album.library !== undefined && ` · ${album.library}’s library`}
                      {album.sharedWith &&
                        album.sharedWith.length > 0 &&
                        ` · Shared with ${album.sharedWith.join(', ')}`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        !canCreate && (
          <p className="album-picker__empty">
            Photos from a library shared with you can only go in that library’s albums, and it has
            none yet.
          </p>
        )
      )}
      {canCreate && (
        <form className="album-picker__new" onSubmit={onCreate} noValidate>
          <TextField
            label="New album"
            placeholder="Album name"
            value={title}
            maxLength={80}
            onChange={(event) => {
              setTitle(event.currentTarget.value);
              setError(null);
            }}
            error={error}
          />
          <button
            type="submit"
            className="btn btn--secondary"
            disabled={busy || creating}
            aria-busy={creating}
          >
            <Icon name="plus" size={18} />
            {sharing ? 'Create and share' : 'Create and add'}
          </button>
        </form>
      )}
    </Dialog>
  );
}
