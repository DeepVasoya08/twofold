import { useDownloads } from '../app/downloads';
import { Link, useRouter } from '../app/router';
import { paths } from '../app/routes';
import { useSelection } from '../app/selection';
import { albumCover, albumPhotos, isViewOnly, useVault } from '../app/vault';
import { AlbumActions } from '../components/AlbumActions';
import { PageHeader } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { PhotoGrid } from '../components/PhotoGrid';
import { PhotoImage } from '../components/PhotoImage';
import { SelectButton } from '../components/SelectButton';
import { SelectionBar } from '../components/SelectionBar';
import { formatDateRange, pluralize } from '../lib/format';

import './album.css';

export function Album({ albumId }: { albumId: string }) {
  const { state } = useVault();
  const { navigate } = useRouter();
  const selection = useSelection();
  const album = state.albums.find((candidate) => candidate.id === albumId);
  const downloads = useDownloads();

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

  const actions = (
    <AlbumActions
      album={album}
      onGone={() => {
        navigate(paths.albums, { replace: true });
      }}
    />
  );
  const sharing = album.sharedAlbum
    ? `Shared with you by ${album.library ?? 'someone'}`
    : album.library !== undefined
      ? `From ${album.library}’s library${album.viewOnly ? ' · view only' : ''}`
      : album.sharedWith
        ? `Shared with ${album.sharedWith.join(', ')}`
        : null;

  return (
    <div className="page">
      <div className="album-toolbar">
        <Link to={paths.albums} className="page-header__back">
          <Icon name="chevron-left" size={16} />
          Albums
        </Link>
        <div className="album-toolbar__actions">
          {photos.length > 0 && (
            <button
              type="button"
              className="btn btn--secondary"
              aria-label="Download album"
              onClick={() => {
                downloads.start(photos.map((photo) => photo.id));
              }}
            >
              <Icon name="download" size={18} />
              <span className="album-toolbar__label">Download</span>
            </button>
          )}
          {photos.length > 0 && <SelectButton selection={selection} />}
          {actions}
        </div>
      </div>
      <SelectionBar
        selection={selection}
        allIds={photos.map((photo) => photo.id)}
        albumId={album.id}
      />

      {cover ? (
        <header className="album-hero">
          <PhotoImage className="album-hero__image" photoId={cover.id} src={cover.src} alt="" />
          <span className="album-hero__shade" />
          <div className="album-hero__text">
            <h1 className="album-hero__title">{album.title}</h1>
            {sharing && (
              <p className="album-hero__shared">
                <Icon name="users" size={14} /> {sharing}
              </p>
            )}
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
        <PageHeader title={album.title} subtitle={sharing ?? 'No photos yet'} />
      )}

      {photos.length === 0 ? (
        <EmptyState icon="image-plus" title="Nothing in here yet">
          {isViewOnly(album)
            ? 'Photos added to this album will show up here.'
            : 'Use Upload to add photos straight into this album.'}
        </EmptyState>
      ) : (
        <PhotoGrid
          photos={photos}
          context={{ kind: 'album', albumId: album.id }}
          selection={selection}
        />
      )}
    </div>
  );
}
