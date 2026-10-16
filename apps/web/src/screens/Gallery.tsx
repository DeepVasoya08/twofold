import { Link } from '../app/router';
import { paths } from '../app/routes';
import { albumCover, albumPhotos, useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { LockBadge } from '../components/Brand';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { PhotoGrid } from '../components/PhotoGrid';
import { formatDateRange, groupByMonth, pluralize } from '../lib/format';

import './gallery.css';

const HIGHLIGHT_ALBUM_ID = 'first-year';

export function Gallery() {
  const { state } = useVault();
  const months = groupByMonth(state.photos);
  const highlight = state.albums.find((album) => album.id === HIGHLIGHT_ALBUM_ID);
  const highlightPhotos = highlight ? albumPhotos(state, highlight.id) : [];
  const highlightCover = highlight ? albumCover(state, highlight) : undefined;

  return (
    <div className="page">
      <PageHeader
        title="Our photos"
        subtitle={
          <>
            {pluralize(state.photos.length, 'photo')} <span aria-hidden="true">·</span>{' '}
            <LockBadge />
          </>
        }
      />

      {state.photos.length === 0 ? (
        <EmptyState icon="image-plus" title="Your vault is ready">
          Add your first photos with the Upload button. They&apos;re encrypted on this device before
          they go anywhere.
        </EmptyState>
      ) : (
        <>
          {highlight && highlightCover && (
            <Link to={paths.album(highlight.id)} className="memory">
              <img className="memory__image" src={highlightCover.src} alt="" />
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

          {months.map((month) => (
            <section key={month.key} className="month" aria-labelledby={`month-${month.key}`}>
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
              </header>
              <PhotoGrid photos={month.photos} context={{ kind: 'all' }} />
            </section>
          ))}
        </>
      )}
    </div>
  );
}
