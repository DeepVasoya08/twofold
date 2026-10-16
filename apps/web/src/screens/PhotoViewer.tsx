import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { PointerEvent } from 'react';

import { Link, useRouter } from '../app/router';
import { parsePhotoContext, paths } from '../app/routes';
import type { PhotoContext } from '../app/routes';
import { useToast } from '../app/toast';
import { albumPhotos, useVault } from '../app/vault';
import type { VaultState } from '../app/vault';
import { Avatar } from '../components/Brand';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { formatDay, formatTime, sortNewestFirst } from '../lib/format';
import { me, partner } from '../mock/data';
import type { Photo } from '../mock/data';

import './photo-viewer.css';

const SWIPE_PX = 50;

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
  const { state, dispatch } = useVault();
  const toast = useToast();
  const [showInfo, setShowInfo] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const swipeStart = useRef<number | null>(null);

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

  // Keyboard: arrows move through the list, Escape closes. Ignored while a dialog is open.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (confirmDelete || event.defaultPrevented) return;
    if (event.key === 'ArrowLeft') go(prev);
    else if (event.key === 'ArrowRight') go(next);
    else if (event.key === 'Escape') back(exit);
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

  const owner = photo.addedBy === 'me' ? me : partner;
  const albums = state.albums.filter((album) => photo.albumIds.includes(album.id));

  const onDelete = () => {
    dispatch({ type: 'delete-photo', photoId: photo.id });
    setConfirmDelete(false);
    toast.show('Photo deleted');
    const fallback = next ?? prev;
    if (fallback) navigate(paths.photo(fallback.id, context), { replace: true });
    else navigate(exit, { replace: true });
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') swipeStart.current = event.clientX;
  };
  const onPointerUp = (event: PointerEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (start === null) return;
    const dx = event.clientX - start;
    if (dx > SWIPE_PX) go(prev);
    else if (dx < -SWIPE_PX) go(next);
  };

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
              setConfirmDelete(true);
            }}
            aria-label="Delete"
          >
            <Icon name="trash" />
          </button>
        </div>
      </header>

      <div className="viewer__stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        <img
          key={photo.id}
          className="viewer__image"
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
                <span>Only you and {partner.name} can see this photo.</span>
              </dd>
            </div>
          </dl>
        </aside>
      )}

      <Dialog
        open={confirmDelete}
        onClose={() => {
          setConfirmDelete(false);
        }}
        title="Delete this photo?"
        description={`It will be removed for both you and ${partner.name}. This can't be undone.`}
      >
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setConfirmDelete(false);
            }}
          >
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
