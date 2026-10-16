import { Link } from '../app/router';
import { paths } from '../app/routes';
import { albumCover, albumPhotos, useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { PhotoGrid } from '../components/PhotoGrid';
import { formatDateRange, pluralize } from '../lib/format';

import './album.css';

export function Album({ albumId }: { albumId: string }) {
  const { state } = useVault();
  const album = state.albums.find((candidate) => candidate.id === albumId);

  if (!album) {
    return (
      <div className="page">
        <PageHeader title="Album not found" back={{ to: paths.albums, label: 'Albums' }} />
        <EmptyState
          icon="albums"
          title="This album isn't here"
          action={
            <Link to={paths.albums} className="btn btn--secondary">
              See all albums
            </Link>
          }
        >
          It may have been deleted, or the link is wrong.
        </EmptyState>
      </div>
    );
  }

  const photos = albumPhotos(state, album.id);
  const cover = albumCover(state, album);
  const range = formatDateRange(photos.map((photo) => photo.takenAt));
  const places = [...new Set(photos.flatMap((photo) => (photo.location ? [photo.location] : [])))];

  return (
    <div className="page">
      <Link to={paths.albums} className="page-header__back">
        <Icon name="chevron-left" size={16} />
        Albums
      </Link>

      {cover ? (
        <header className="album-hero">
          <img className="album-hero__image" src={cover.src} alt="" />
          <span className="album-hero__shade" />
          <div className="album-hero__text">
            <h1 className="album-hero__title">{album.title}</h1>
            <p className="album-hero__meta">
              {pluralize(photos.length, 'photo')}
              {range && <> · {range}</>}
              {places.length > 0 && (
                <>
                  {' '}
                  · <Icon name="pin" size={14} /> {places.join(', ')}
                </>
              )}
            </p>
          </div>
        </header>
      ) : (
        <PageHeader title={album.title} subtitle="No photos yet" />
      )}

      {photos.length === 0 ? (
        <EmptyState icon="image-plus" title="Nothing in here yet">
          Use Upload to add photos straight into this album.
        </EmptyState>
      ) : (
        <PhotoGrid photos={photos} context={{ kind: 'album', albumId: album.id }} />
      )}
    </div>
  );
}
