import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import type { SpaceKeys } from '@arcafold/crypto';

import { useAccount, useMe } from '../app/account';
import { errorMessage } from '../app/account-ops';
import { useSmartAlbum } from '../app/answer';
import { useFind } from '../app/find';
import { useSearch } from '../app/search';
import { useGroupPhotoIds } from '../app/people';
import { Link, useRouter } from '../app/router';
import { parsePhotoContext, paths } from '../app/routes';
import type { PhotoContext } from '../app/routes';
import { useToast } from '../app/toast';
import type { ToastAction } from '../app/toast';
import { documentPhotos, useDocumentLooks, useHiddenFromTimeline } from '../app/document-photos';
import { albumPhotos, isViewOnly, timelinePhotos, trashNote, useVault } from '../app/vault';
import type { VaultState } from '../app/vault';
import { Avatar } from '../components/Brand';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { MoveSpaceDialog, moveLabel } from '../components/MoveSpaceDialog';
import { PhotoImage } from '../components/PhotoImage';
import { formatDay, formatTime, sortNewestFirst } from '../lib/format';
import type { DocumentLook } from '../lib/file-sort/looks';
import type { Person, Photo } from '../mock/data';

import { useZoom } from './use-zoom';

import './photo-viewer.css';

/**
 * The photos the viewer steps through. A person's come from `listedIds`, in order, and so
 * do a search's and a smart album's. `looks` says which photos look like documents, and
 * `hidden` which of them are left out of the timeline.
 */
export function photosInContext(
  state: VaultState,
  context: PhotoContext,
  listedIds: readonly string[] | null = null,
  looks: ReadonlyMap<string, DocumentLook> = new Map(),
  hidden: ReadonlySet<string> = new Set(),
): Photo[] {
  switch (context.kind) {
    case 'documents':
      return documentPhotos(state, looks);
    case 'album':
      return albumPhotos(state, context.albumId);
    case 'person':
    case 'search':
    case 'smart': {
      const byId = new Map(state.photos.map((photo) => [photo.id, photo]));
      return (listedIds ?? []).flatMap((id) => {
        const photo = byId.get(id);
        return photo ? [photo] : [];
      });
    }
    case 'favorites':
      return sortNewestFirst(timelinePhotos(state).filter((photo) => photo.favorite));
    case 'all':
      return sortNewestFirst(timelinePhotos(state).filter((photo) => !hidden.has(photo.id)));
  }
}

function closeTarget(context: PhotoContext): string {
  switch (context.kind) {
    case 'album':
      return paths.album(context.albumId);
    case 'favorites':
      return paths.favorites;
    case 'person':
      return paths.person(context.groupId);
    case 'search':
      return paths.search;
    case 'smart':
      return paths.smartAlbum(context.albumId);
    case 'documents':
      return paths.files;
    case 'all':
      return paths.gallery;
  }
}

export function PhotoViewer({ photoId }: { photoId: string }) {
  const { search, navigate, back } = useRouter();
  const { state, space, toggleFavorite, deletePhoto, restorePhotos, movePhoto, loadFull } =
    useVault();
  const { otherSpaceOpen } = useAccount();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [showInfo, setShowInfo] = useState(false);
  const [dialog, setDialog] = useState<'delete' | 'move' | null>(null);
  const isPrivate = space === 'private';
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const context = parsePhotoContext(search);
  const groupPhotoIds = useGroupPhotoIds(context.kind === 'person' ? context.groupId : null);
  const { shownIds, searchLike } = useFind();
  const smartSearch = useSearch();
  const looks = useDocumentLooks();
  const hidden = useHiddenFromTimeline();
  const smart = useSmartAlbum(
    context.kind === 'smart'
      ? smartSearch.smartAlbums.find((album) => album.id === context.albumId)
      : undefined,
  );
  const list = photosInContext(
    state,
    context,
    context.kind === 'search'
      ? shownIds
      : context.kind === 'smart'
        ? [...(smart?.found?.best ?? []), ...(smart?.found?.more ?? [])]
        : groupPhotoIds,
    looks,
    hidden,
  );
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

  // The grid only has the small preview; fetch and decrypt the original for viewing.
  const needsFull = photo !== undefined && !photo.fullSrc;
  useEffect(() => {
    if (needsFull) loadFull(photoId);
  }, [needsFull, photoId, loadFull]);

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

  const owner: Person =
    photo.addedBy === 'me'
      ? me
      : { id: 'contact', name: photo.addedByName ?? 'Someone', email: '' };
  // Photos shared with you to view (in an album, or a view-only library) can be viewed and
  // downloaded, nothing more.
  const viewOnly = isViewOnly(photo);
  // Photos in a library someone shared with you stay in it.
  const canMove = photo.library === undefined;
  const albums = state.albums.filter((album) => photo.albumIds.includes(album.id));

  const closeDialog = () => {
    setDialog(null);
  };

  /** After a photo leaves this list, show its neighbour, or go back to the grid. */
  const leave = () => {
    const fallback = next ?? prev;
    if (fallback) navigate(paths.photo(fallback.id, context), { replace: true });
    else navigate(exit, { replace: true });
  };

  /** Runs a change to the photo, showing `failed` if it doesn't go through. */
  const act = (change: () => Promise<void>, done: string, action?: ToastAction) => {
    if (busy) return;
    setBusy(true);
    change().then(
      () => {
        setBusy(false);
        closeDialog();
        toast.show(done, action);
        leave();
      },
      (error: unknown) => {
        setBusy(false);
        closeDialog();
        toast.show(errorMessage(error));
      },
    );
  };

  const onDelete = () => {
    const photoId = photo.id;
    act(() => deletePhoto(photoId), 'Moved to Recently deleted', {
      label: 'Undo',
      run: () => {
        restorePhotos([photoId]).then(
          (result) => {
            if (result.failed.length > 0) toast.show(errorMessage(result.error));
          },
          (error: unknown) => {
            toast.show(errorMessage(error));
          },
        );
      },
    });
  };

  const move = (otherKeys?: SpaceKeys) => {
    act(
      () => movePhoto(photo.id, otherKeys),
      isPrivate ? 'Moved to your library' : 'Moved to your private space',
    );
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
          {!viewOnly && (
            <button
              type="button"
              className={`viewer__btn${photo.favorite ? ' is-favorite' : ''}`}
              onClick={() => {
                toggleFavorite(photo.id).catch((error: unknown) => {
                  toast.show(errorMessage(error));
                });
              }}
              aria-label={photo.favorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={photo.favorite}
            >
              <Icon name="heart" filled={photo.favorite} />
            </button>
          )}
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
          {smartSearch.enabled && (
            <button
              type="button"
              className="viewer__btn"
              onClick={() => {
                searchLike(photo.id);
                navigate(paths.search);
              }}
              aria-label="More like this"
              title="More like this"
            >
              <Icon name="search" />
            </button>
          )}
          <a
            className="viewer__btn viewer__btn--wide-only"
            href={photo.fullSrc}
            download={`arcafold-${photo.id}`}
            aria-label="Download"
          >
            <Icon name="download" />
          </a>
          {canMove && (
            <button
              type="button"
              className="viewer__btn"
              disabled={busy}
              onClick={() => {
                if (otherSpaceOpen) move();
                else setDialog('move');
              }}
              aria-label={moveLabel(space)}
              title={moveLabel(space)}
            >
              <Icon name={isPrivate ? 'photos' : 'eye-off'} />
            </button>
          )}
          {!viewOnly && (
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
          )}
        </div>
      </header>

      <div
        ref={stageRef}
        className={`viewer__stage${zoom.zoomed ? ' is-zoomed' : ''}${zoom.dragging ? ' is-dragging' : ''}`}
        {...zoom.stageHandlers}
      >
        <PhotoImage
          key={photo.id}
          ref={imageRef}
          className="viewer__image"
          style={imageStyle}
          photoId={photo.id}
          src={photo.viewSrc ?? photo.fullSrc ?? photo.src}
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
        <span
          className={`viewer__zoom${zoom.levelShown ? ' is-shown' : ''}`}
          role="status"
          aria-label="Zoom level"
        >
          {zoom.percent}%
        </span>
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
                  {photo.sharedAlbum
                    ? `${photo.library ?? 'Someone'} shared it with you in an album. You can view and download it.`
                    : viewOnly
                      ? `It’s in ${photo.library ?? 'someone'}’s library, shared with you to view. You can view and download it.`
                      : photo.library !== undefined
                        ? `Only people in ${photo.library}’s library can see it.`
                        : isPrivate
                          ? 'Only you, and anyone you share this private space with, can see it.'
                          : 'Only you and people you share this library with can see it.'}
                </span>
              </dd>
            </div>
          </dl>
        </aside>
      )}

      <MoveSpaceDialog
        open={dialog === 'move'}
        space={space}
        count={1}
        busy={busy}
        onClose={closeDialog}
        onUnlocked={move}
      />

      <Dialog
        open={dialog === 'delete'}
        onClose={closeDialog}
        title="Delete this photo?"
        description={`${
          photo.library !== undefined
            ? `It will be removed from ${photo.library}’s library for everyone.`
            : isPrivate
              ? 'It will be removed from your private space, and for anyone you share it with.'
              : 'It will be removed for everyone you share this library with.'
        } ${trashNote(1)}`}
      >
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={closeDialog}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={onDelete}
            disabled={busy}
            aria-busy={busy}
          >
            Delete
          </button>
        </div>
      </Dialog>
    </div>
  );
}
