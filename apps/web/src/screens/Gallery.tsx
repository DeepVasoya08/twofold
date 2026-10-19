import { Link } from '../app/router';
import { paths } from '../app/routes';
import { allSelected, useSelection } from '../app/selection';
import { albumCover, albumPhotos, useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { LockBadge } from '../components/Brand';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { PhotoGrid } from '../components/PhotoGrid';
import { PhotoImage } from '../components/PhotoImage';
import { SelectButton } from '../components/SelectButton';
import { SelectionBar } from '../components/SelectionBar';
import { formatDateRange, groupByMonth, pluralize } from '../lib/format';

import './gallery.css';

const HIGHLIGHT_MIN_PHOTOS = 3;

export function Gallery() {
  const { state, space, status } = useVault();
  const isPrivate = space === 'private';
  const months = groupByMonth(state.photos);
  const highlight = state.albums.find(
    (album) => albumPhotos(state, album.id).length >= HIGHLIGHT_MIN_PHOTOS,
  );
  const highlightPhotos = highlight ? albumPhotos(state, highlight.id) : [];
  const highlightCover = highlight ? albumCover(state, highlight) : undefined;
  const selection = useSelection();
  const hasPhotos = status === 'ready' && state.photos.length > 0;

  return (
    <div className="page">
      <PageHeader
        title={isPrivate ? 'Private space' : 'Photos'}
        subtitle={
          <>
            {pluralize(state.photos.length, 'photo')} <span aria-hidden="true">·</span>{' '}
            <LockBadge label={isPrivate ? 'Opens only with your private password' : undefined} />
          </>
        }
        actions={hasPhotos && <SelectButton selection={selection} />}
      />
      <SelectionBar selection={selection} allIds={state.photos.map((photo) => photo.id)} />

      {status === 'failed' ? (
        <EmptyState icon="lock" title="Couldn’t open your photos">
          Check your connection, then lock Twofold and unlock it again to try again.
        </EmptyState>
      ) : status === 'loading' ? (
        <p className="gallery__status" role="status">
          Decrypting your photos…
        </p>
      ) : state.photos.length === 0 ? (
        isPrivate ? (
          <EmptyState icon="eye-off" title="Your private space is empty">
            Move photos here from your library, or upload straight in. They only appear when you
            open Twofold with your private password.
          </EmptyState>
        ) : (
          <EmptyState icon="image-plus" title="Your library is ready">
            Add your first photos with the Upload button. They&apos;re encrypted on this device
            before they go anywhere.
          </EmptyState>
        )
      ) : (
        <>
          {highlight && highlightCover && (
            <Link to={paths.album(highlight.id)} className="memory">
              <PhotoImage
                className="memory__image"
                photoId={highlightCover.id}
                src={highlightCover.src}
                alt=""
              />
              <span className="memory__shade" />
              <span className="memory__text">
                <span className="memory__eyebrow">
                  <Icon name="sparkle" size={14} /> Remember this?
                </span>
                <span className="memory__title">{highlight.title}</span>
                <span className="memory__meta">
                  {pluralize(highlightPhotos.length, 'photo')} ·{' '}
                  {formatDateRange(highlightPhotos.map((photo) => photo.takenAt))}
                </span>
              </span>
            </Link>
          )}

          {months.map((month) => {
            const ids = month.photos.map((photo) => photo.id);
            const whole = allSelected(selection.selected, ids);
            return (
              <section
                key={month.key}
                className={`month${selection.selecting ? ' is-selecting' : ''}`}
                aria-labelledby={`month-${month.key}`}
              >
                <header className="month__header">
                  <h2 className="month__title" id={`month-${month.key}`}>
                    {month.label}
                  </h2>
                  {month.locations.length > 0 && (
                    <span className="month__places">
                      <Icon name="pin" size={14} />
                      {month.locations.join(' · ')}
                    </span>
                  )}
                  <button
                    type="button"
                    className={`month__select${whole ? ' is-on' : ''}`}
                    aria-pressed={whole}
                    aria-label={`${whole ? 'Deselect' : 'Select'} all of ${month.label}`}
                    onClick={() => {
                      selection.setMany(ids, !whole);
                    }}
                  >
                    <span className="month__select-check">
                      <Icon name="check" size={12} />
                    </span>
                    {whole ? 'Deselect all' : 'Select all'}
                  </button>
                </header>
                <PhotoGrid photos={month.photos} context={{ kind: 'all' }} selection={selection} />
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
