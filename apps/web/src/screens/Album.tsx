import { useDownloads } from '../app/downloads';
import { Link, useRouter } from '../app/router';
import { paths } from '../app/routes';
import { useSelection } from '../app/selection';
import { useToast } from '../app/toast';
import { useUploads } from '../app/uploads';
import {
  albumCover,
  albumFiles,
  albumPhotos,
  canFillAlbum,
  isViewOnly,
  useVault,
} from '../app/vault';
import { albumSharing } from '@arcafold/core/library/albums';
import { AlbumActions } from '../components/AlbumActions';
import { PageHeader } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { FileRow, fileDetails } from '../components/FileRow';
import type { MenuItem } from '../components/Menu';
import { Icon } from '../components/Icon';
import { PhotoGrid } from '../components/PhotoGrid';
import { PhotoImage } from '../components/PhotoImage';
import { SelectButton } from '../components/SelectButton';
import { PhotoViewPicker } from '../components/ViewPicker';
import { SelectionBar } from '../components/SelectionBar';
import { formatDateRange, photosAndFiles } from '../lib/format';
import type { Album as AlbumData, Photo } from '@arcafold/core/library/model';

import './album.css';

export function Album({ albumId }: { albumId: string }) {
  const vault = useVault();
  const { state } = vault;
  const toast = useToast();
  const { navigate } = useRouter();
  const selection = useSelection();
  const album = state.albums.find((candidate) => candidate.id === albumId);
  const downloads = useDownloads();
  // Uploads made while an album is open go into it.
  const { openDialog: openUpload } = useUploads();

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
  const files = albumFiles(state, album.id);
  const items = [...photos, ...files];
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
  const sharing = albumSharing(album);

  return (
    <div className="page">
      <div className="album-toolbar">
        <Link to={paths.albums} className="page-header__back">
          <Icon name="chevron-left" size={16} />
          Albums
        </Link>
        <div className="album-toolbar__actions">
          {canFillAlbum(album) && (
            <button
              type="button"
              className="btn btn--secondary"
              aria-label="Add photos"
              onClick={openUpload}
            >
              <Icon name="image-plus" size={18} />
              <span className="album-toolbar__label">Add photos</span>
            </button>
          )}
          {items.length > 0 && (
            <button
              type="button"
              className="btn btn--secondary"
              aria-label="Download album"
              onClick={() => {
                downloads.start(items.map((item) => item.id));
              }}
            >
              <Icon name="download" size={18} />
              <span className="album-toolbar__label">Download</span>
            </button>
          )}
          {photos.length > 0 && <PhotoViewPicker />}
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
              {photosAndFiles(items)}
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
        <PageHeader
          title={album.title}
          subtitle={sharing ?? (items.length > 0 ? photosAndFiles(items) : 'No photos yet')}
        />
      )}

      {items.length === 0 ? (
        <EmptyState icon="image-plus" title="Nothing in here yet">
          {!canFillAlbum(album)
            ? 'Photos and files added to this album will show up here.'
            : album.sharedAlbum
              ? 'Use Upload to add photos to this album. Everyone it’s shared with will see them.'
              : 'Use Upload to add photos and files straight into this album.'}
        </EmptyState>
      ) : (
        <>
          {photos.length > 0 && (
            <PhotoGrid
              photos={photos}
              context={{ kind: 'album', albumId: album.id }}
              selection={selection}
            />
          )}
          {files.length > 0 && (
            <section className="album-files" aria-labelledby="album-files-title">
              <h2 className="album-files__title" id="album-files-title">
                Files
              </h2>
              <ul className="file-list" aria-label="Files in this album">
                {files.map((item) => (
                  <FileRow
                    key={item.id}
                    item={item}
                    albumId={album.id}
                    details={fileDetails(item, null)}
                    menu={fileMenu(item, album, {
                      download: () => {
                        downloads.start([item.id]);
                      },
                      remove: () => {
                        vault.setDetails([item.id], { album, included: false }).then(
                          (result) => {
                            toast.show(
                              result.done.length > 0
                                ? `Removed from “${album.title}”`
                                : 'Couldn’t remove it. Try again.',
                            );
                          },
                          () => {
                            toast.show('Couldn’t remove it. Try again.');
                          },
                        );
                      },
                    })}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** A file's menu inside an album: download it, and take it out unless that isn't yours to do. */
export function fileMenu(
  item: Photo,
  album: AlbumData,
  actions: { download: () => void; remove: () => void },
): MenuItem[] {
  const items: MenuItem[] = [{ label: 'Download', icon: 'download', onSelect: actions.download }];
  if (!isViewOnly(album) && !isViewOnly(item)) {
    items.push({ label: 'Remove from album', icon: 'x', onSelect: actions.remove });
  }
  return items;
}
