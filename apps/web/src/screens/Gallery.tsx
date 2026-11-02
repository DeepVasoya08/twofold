import { useState } from 'react';

import { Link } from '../app/router';
import { paths } from '../app/routes';
import { allSelected, useSelection } from '../app/selection';
import { albumCover, albumPhotos, timelinePhotos, useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { LockBadge } from '../components/Brand';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { PhotoGrid } from '../components/PhotoGrid';
import { PhotoImage } from '../components/PhotoImage';
import { SelectButton } from '../components/SelectButton';
import { SelectionBar } from '../components/SelectionBar';
import { formatDateRange, groupByMonth, pluralize } from '../lib/format';
import type { Photo } from '../mock/data';

import './gallery.css';

const HIGHLIGHT_MIN_PHOTOS = 3;

/** Whose photos the timeline shows: everyone's, only yours, or only ones shared with you. */
export type OwnerFilter = 'all' | 'mine' | 'shared';

const FILTERS: readonly { id: OwnerFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
  { id: 'shared', label: 'Shared with me' },
];

export function filterByOwner(photos: readonly Photo[], filter: OwnerFilter): Photo[] {
  switch (filter) {
    case 'all':
      return [...photos];
    case 'mine':
      return photos.filter((photo) => photo.library === undefined);
    case 'shared':
      return photos.filter((photo) => photo.library !== undefined);
  }
}

export function Gallery() {
  const { state, space, status } = useVault();
  const isPrivate = space === 'private';
  const timeline = timelinePhotos(state);
  // Only worth offering once something in the timeline is someone else's.
  const hasShared = timeline.some((photo) => photo.library !== undefined);
  const [chosen, setFilter] = useState<OwnerFilter>('all');
  const filter = hasShared ? chosen : 'all';
  const photos = filterByOwner(timeline, filter);
  const months = groupByMonth(photos);
  const highlight = state.albums.find(
    (album) => albumPhotos(state, album.id).length >= HIGHLIGHT_MIN_PHOTOS,
  );
  const highlightPhotos = highlight ? albumPhotos(state, highlight.id) : [];
  const highlightCover = highlight ? albumCover(state, highlight) : undefined;
  const selection = useSelection();
  const hasPhotos = status === 'ready' && photos.length > 0;

  return (
    <div className="page">
      <PageHeader
        title={isPrivate ? 'Private space' : 'Photos'}
        subtitle={
          <>
            {pluralize(timeline.length, 'photo')} <span aria-hidden="true">·</span>{' '}
            <LockBadge label={isPrivate ? 'Opens only with your private password' : undefined} />
          </>
        }
        actions={hasPhotos && <SelectButton selection={selection} />}
      />
      <SelectionBar selection={selection} allIds={photos.map((photo) => photo.id)} />
      {hasShared && status === 'ready' && (
        <div className="owner-filter" role="group" aria-label="Show photos">
          {FILTERS.map((each) => (
            <button
              key={each.id}
              type="button"
              className="owner-filter__option"
              aria-pressed={filter === each.id}
              onClick={() => {
                setFilter(each.id);
              }}
            >
              {each.label}
            </button>
          ))}
        </div>
      )}

      {status === 'failed' ? (
        <EmptyState icon="lock" title="Couldn’t open your photos">
          Check your connection, then lock Arcafold and unlock it again to try again.
        </EmptyState>
      ) : status === 'loading' ? (
        <p className="gallery__status" role="status">
          Decrypting your photos…
        </p>
      ) : photos.length === 0 && filter !== 'all' ? (
        <EmptyState icon="users" title="Nothing here">
          {filter === 'mine'
            ? 'Everything here was shared with you. Photos you upload show up under Mine.'
            : 'Nobody has shared photos with you yet.'}
        </EmptyState>
      ) : photos.length === 0 ? (
        isPrivate ? (
          <EmptyState icon="eye-off" title="Your private space is empty">
            Move photos here from your library, or upload straight in. They only appear when you
            open Arcafold with your private password.
          </EmptyState>
        ) : (
          <EmptyState
            icon="image-plus"
            title="Your library is ready"
            action={
              <Link to={paths.import} className="btn btn--secondary">
                <Icon name="cloud" size={18} />
                Import from Google or Apple
              </Link>
            }
          >
            Add your first photos with the Upload button, or bring your library over from Google
            Photos or Apple Photos. They&apos;re encrypted on this device before they go anywhere.
          </EmptyState>
        )
      ) : (
        <>
          {filter === 'all' && highlight && highlightCover && (
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
