import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { CSSProperties, SubmitEvent } from 'react';

import { useAccount, useMe } from '../app/account';
import { Link, useRouter } from '../app/router';
import { parsePhotoContext, paths } from '../app/routes';
import type { PhotoContext } from '../app/routes';
import { useToast } from '../app/toast';
import { albumPhotos, useVault } from '../app/vault';
import type { VaultState } from '../app/vault';
import { Avatar } from '../components/Brand';
import { Dialog } from '../components/Dialog';
import { PasswordField } from '../components/Field';
import { Icon } from '../components/Icon';
import { formatDay, formatTime, sortNewestFirst } from '../lib/format';
import { contact } from '../mock/data';
import type { Photo } from '../mock/data';

import { useZoom } from './use-zoom';

import './photo-viewer.css';

export function photosInContext(state: VaultState, context: PhotoContext): Photo[] {
  switch (context.kind) {
    case 'album':
      return albumPhotos(state, context.albumId);
    case 'favorites':
      return sortNewestFirst(state.photos.filter((photo) => photo.favorite));
    case 'all':
      return sortNewestFirst(state.photos);
  }
}

function closeTarget(context: PhotoContext): string {
  switch (context.kind) {
    case 'album':
      return paths.album(context.albumId);
    case 'favorites':
      return paths.favorites;
    case 'all':
      return paths.gallery;
  }
}

export function PhotoViewer({ photoId }: { photoId: string }) {
  const { search, navigate, back } = useRouter();
  const { state, dispatch, space, movePhoto } = useVault();
  const { privateSpaceOpen, openPrivateSpace } = useAccount();
  const me = useMe();
  const [checking, setChecking] = useState(false);
  const toast = useToast();
  const [showInfo, setShowInfo] = useState(false);
  const [dialog, setDialog] = useState<'delete' | 'move' | null>(null);
  const [privatePassword, setPrivatePassword] = useState('');
  const [moveError, setMoveError] = useState<string | null>(null);
  const isPrivate = space === 'private';
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const context = parsePhotoContext(search);
  const list = photosInContext(state, context);
  // A photo un-favorited from the favorites view is no longer in that list; keep showing it.
  const photo = state.photos.find((candidate) => candidate.id === photoId);
  const index = list.findIndex((candidate) => candidate.id === photoId);
  const prev = index > 0 ? list[index - 1] : undefined;
  const next = index >= 0 ? list[index + 1] : undefined;
  const exit = closeTarget(context);

  const go = (target: Photo | undefined) => {
    if (target) navigate(paths.photo(target.id, context), { replace: true });
  };

  const zoom = useZoom({
    stageRef,
    imageRef,
    resetKey: photoId,
    onSwipe: (direction) => {
      go(direction === 'prev' ? prev : next);
    },
  });

  // Keyboard: arrows move through the list, Escape closes. Ignored while a dialog is open.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (dialog || event.defaultPrevented) return;
    if (event.key === 'ArrowLeft') go(prev);
    else if (event.key === 'ArrowRight') go(next);
    else if (event.key === 'Escape') back(exit);
    else if (event.key === '+' || event.key === '=') zoom.zoomBy(1.5);
    else if (event.key === '-') zoom.zoomBy(1 / 1.5);
    else if (event.key === '0') zoom.reset();
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!photo) {
    return (
      <div className="viewer viewer--missing">
        <p>This photo isn&apos;t in your vault anymore.</p>
        <Link to={exit} className="btn btn--secondary">
          Back to photos
        </Link>
      </div>
    );
  }

  const owner = photo.addedBy === 'me' ? me : contact;
  const albums = state.albums.filter((album) => photo.albumIds.includes(album.id));

  const closeDialog = () => {
    setDialog(null);
    setPrivatePassword('');
    setMoveError(null);
  };

  /** After a photo leaves this list, show its neighbour, or go back to the grid. */
  const leave = () => {
    const fallback = next ?? prev;
    if (fallback) navigate(paths.photo(fallback.id, context), { replace: true });
    else navigate(exit, { replace: true });
  };

  const onDelete = () => {
    dispatch({ type: 'delete-photo', photoId: photo.id });
    closeDialog();
    toast.show('Photo deleted');
    leave();
  };

  const onMoveOut = () => {
    movePhoto(photo.id, 'main');
    toast.show('Moved to your library');
    leave();
  };

  const moveIn = () => {
    movePhoto(photo.id, 'private');
    toast.show('Moved to your private space');
    leave();
  };

  // The main library can't reach the private space on its own, so the first move asks for
  // the private password once. The key then stays in memory until Twofold locks, and later
  // moves go straight in. A wrong password gets the same answer as no private space at all.
  const onMoveIn = (event: SubmitEvent) => {
    event.preventDefault();
    if (checking) return;
    setChecking(true);
    void openPrivateSpace(privatePassword)
      .then(
        () => true,
        () => false,
      )
      .then((opens) => {
        setChecking(false);
        if (!opens) {
          setMoveError(
            "That password doesn't open a private space. You can set one up in Settings.",
          );
          return;
        }
        closeDialog();
        moveIn();
      });
  };

  const imageStyle: CSSProperties | undefined = zoom.zoomed
    ? {
        transform: `translate(${String(zoom.view.x)}px, ${String(zoom.view.y)}px) scale(${String(zoom.view.scale)})`,
      }
    : undefined;

  return (
    <div className={`viewer${showInfo ? ' viewer--info' : ''}`}>
      <header className="viewer__bar">
        <button
          type="button"
          className="viewer__btn"
          onClick={() => {
            back(exit);
          }}
          aria-label="Close"
        >
          <Icon name="arrow-left" />
        </button>
        <div className="viewer__title">
          <span className="viewer__date">{formatDay(photo.takenAt)}</span>
          {photo.location && <span className="viewer__place">{photo.location}</span>}
        </div>
        <div className="viewer__actions">
          <button
            type="button"
            className={`viewer__btn${photo.favorite ? ' is-favorite' : ''}`}
            onClick={() => {
              dispatch({ type: 'toggle-favorite', photoId: photo.id });
            }}
            aria-label={photo.favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={photo.favorite}
          >
            <Icon name="heart" filled={photo.favorite} />
          </button>
          <button
            type="button"
            className={`viewer__btn${showInfo ? ' is-active' : ''}`}
            onClick={() => {
              setShowInfo((value) => !value);
            }}
            aria-label="Photo details"
            aria-pressed={showInfo}
          >
            <Icon name="info" />
          </button>
          <a
            className="viewer__btn viewer__btn--wide-only"
            href={photo.src}
            download={`twofold-${photo.id}`}
            aria-label="Download"
          >
            <Icon name="download" />
          </a>
          <button
            type="button"
            className="viewer__btn"
            onClick={() => {
              if (isPrivate) onMoveOut();
              else if (privateSpaceOpen) moveIn();
              else setDialog('move');
            }}
            aria-label={isPrivate ? 'Move to library' : 'Move to private space'}
            title={isPrivate ? 'Move to library' : 'Move to private space'}
          >
            <Icon name={isPrivate ? 'photos' : 'eye-off'} />
          </button>
          <button
            type="button"
            className="viewer__btn"
            onClick={() => {
              setDialog('delete');
            }}
            aria-label="Delete"
          >
            <Icon name="trash" />
          </button>
        </div>
      </header>

      <div
        ref={stageRef}
        className={`viewer__stage${zoom.zoomed ? ' is-zoomed' : ''}${zoom.dragging ? ' is-dragging' : ''}`}
        {...zoom.stageHandlers}
      >
        <img
          key={photo.id}
          ref={imageRef}
          className="viewer__image"
          style={imageStyle}
          src={photo.src}
          alt={`Photo from ${formatDay(photo.takenAt)}${photo.location ? ` in ${photo.location}` : ''}`}
          draggable={false}
        />
        {prev && (
          <button
            type="button"
            className="viewer__nav viewer__nav--prev"
            onClick={() => {
              go(prev);
            }}
            aria-label="Previous photo"
          >
            <Icon name="chevron-left" size={26} />
          </button>
        )}
        {next && (
          <button
            type="button"
            className="viewer__nav viewer__nav--next"
            onClick={() => {
              go(next);
            }}
            aria-label="Next photo"
          >
            <Icon name="chevron-right" size={26} />
          </button>
        )}
        {index >= 0 && (
          <span className="viewer__count">
            {index + 1} / {list.length}
          </span>
        )}
      </div>

      {showInfo && (
        <aside className="viewer__info" aria-label="Photo details">
          <h2 className="viewer__info-title">Details</h2>
          <dl className="details">
            <div>
              <dt>
                <Icon name="calendar" size={18} />
              </dt>
              <dd>
                {formatDay(photo.takenAt)}
                <span>{formatTime(photo.takenAt)}</span>
              </dd>
            </div>
            {photo.location && (
              <div>
                <dt>
                  <Icon name="pin" size={18} />
                </dt>
                <dd>{photo.location}</dd>
              </div>
            )}
            <div>
              <dt>
                <Avatar person={owner} size="sm" />
              </dt>
              <dd>
                Added by {owner.id === 'me' ? 'you' : owner.name}
                <span>
                  {String(photo.width)} × {String(photo.height)}
                </span>
              </dd>
            </div>
            {albums.length > 0 && (
              <div>
                <dt>
                  <Icon name="albums" size={18} />
                </dt>
                <dd>
                  {albums.map((album) => (
                    <Link key={album.id} to={paths.album(album.id)} className="details__album">
                      {album.title}
                    </Link>
                  ))}
                </dd>
              </div>
            )}
            <div>
              <dt>
                <Icon name="lock" size={18} />
              </dt>
              <dd>
                End-to-end encrypted
                <span>
                  {isPrivate
                    ? 'Only you can see it, and only after opening Twofold with your private password.'
                    : 'Only you and people you share this library with can see it.'}
                </span>
              </dd>
            </div>
          </dl>
        </aside>
      )}

      <Dialog
        open={dialog === 'move'}
        onClose={closeDialog}
        title="Move to private space"
        description="Enter your private password. The photo will leave your library and only appear when you open Twofold with that password. You won't be asked again until Twofold locks."
      >
        <form className="form" onSubmit={onMoveIn} noValidate>
          <PasswordField
            label="Private password"
            autoComplete="off"
            value={privatePassword}
            onChange={(event) => {
              setPrivatePassword(event.currentTarget.value);
              setMoveError(null);
            }}
            error={moveError}
          />
          <div className="dialog__actions">
            <button type="button" className="btn btn--ghost" onClick={closeDialog}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={checking}
              aria-busy={checking}
            >
              {checking ? 'Checking…' : 'Move'}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={dialog === 'delete'}
        onClose={closeDialog}
        title="Delete this photo?"
        description={
          isPrivate
            ? "It will be removed from your private space. This can't be undone."
            : "It will be removed for everyone you share this library with. This can't be undone."
        }
      >
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={closeDialog}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </Dialog>
    </div>
  );
}
