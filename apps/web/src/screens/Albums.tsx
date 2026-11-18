import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { Link, useRouter } from '../app/router';
import { paths } from '../app/routes';
import { useSmartAlbum } from '../app/answer';
import { useSearch } from '../app/search';
import { useToast } from '../app/toast';
import { albumCover, albumFiles, albumPhotos, isViewOnly, useVault } from '../app/vault';
import { AlbumActions } from '../components/AlbumActions';
import { PageHeader } from '../components/AppShell';
import { Dialog } from '../components/Dialog';
import { TextField } from '../components/Field';
import { Icon } from '../components/Icon';
import { PhotoImage } from '../components/PhotoImage';
import { formatDateRange, photosAndFiles, pluralize } from '../lib/format';
import type { SmartAlbum } from '@arcafold/core/search/smart-album';
import { errorMessage } from '@arcafold/core/errors';
import type { Album } from '@arcafold/core/library/model';
import { albumsInTab } from '@arcafold/core/library/albums';
import type { AlbumTab } from '@arcafold/core/library/albums';

export { albumsInTab };
export type { AlbumTab };

import './albums.css';

const TABS: readonly { id: AlbumTab; label: string }[] = [
  { id: 'all', label: 'All albums' },
  { id: 'with-me', label: 'Shared with me' },
  { id: 'by-me', label: 'Shared by me' },
];

const EMPTY: Record<AlbumTab, string> = {
  all: 'No albums yet. Make one with New album.',
  'with-me':
    'Nothing’s shared with you yet. When someone shares an album with you, it shows up here.',
  'by-me':
    'You haven’t shared any albums. Open an album’s menu and choose Share to invite someone.',
};

export function Albums() {
  const { state, createAlbum } = useVault();
  const { enabled, smartAlbums: savedSearches } = useSearch();
  const [tab, setTab] = useState<AlbumTab>('all');
  const shown = albumsInTab(state.albums, tab);
  // Smart albums are your own and can't be shared, so only All albums lists them.
  const smart = tab === 'all' && enabled ? savedSearches : [];
  const [busy, setBusy] = useState(false);
  const { navigate } = useRouter();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const closeCreate = () => {
    setCreating(false);
    setTitle('');
    setError(null);
  };

  const onCreate = (event: SubmitEvent) => {
    event.preventDefault();
    const name = title.trim();
    if (!name) {
      setError('Give your album a name.');
      return;
    }
    if (busy) return;
    setBusy(true);
    createAlbum(name)
      .then(
        (album) => {
          toast.show(`“${name}” created`);
          closeCreate();
          navigate(paths.album(album.id));
        },
        (caught: unknown) => {
          setError(errorMessage(caught));
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="page">
      <PageHeader
        title="Albums"
        subtitle={pluralize(shown.length + smart.length, 'album')}
        actions={
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              setCreating(true);
            }}
          >
            <Icon name="plus" size={18} />
            New album
          </button>
        }
      />

      <div className="album-tabs" role="tablist" aria-label="Albums">
        {TABS.map((each) => (
          <button
            key={each.id}
            type="button"
            role="tab"
            id={`album-tab-${each.id}`}
            aria-selected={tab === each.id}
            aria-controls="album-tab-panel"
            className="album-tabs__tab"
            onClick={() => {
              setTab(each.id);
            }}
          >
            {each.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="album-tab-panel" aria-labelledby={`album-tab-${tab}`}>
        {shown.length + smart.length === 0 && <p className="album-tabs__empty">{EMPTY[tab]}</p>}
        {tab === 'with-me' && (
          <p className="album-tabs__code">
            Got an invite code from someone? <Link to={paths.joinCode}>Enter it here</Link>
          </p>
        )}
        <ul className="album-grid">
          {shown.map((album) => {
            const photos = albumPhotos(state, album.id);
            const files = albumFiles(state, album.id);
            const cover = albumCover(state, album);
            const range = formatDateRange(photos.map((photo) => photo.takenAt));
            return (
              <li key={album.id} className="album-grid__item">
                <Link to={paths.album(album.id)} className="album-card">
                  <span className="album-card__cover">
                    {cover ? (
                      <>
                        <PhotoImage
                          photoId={cover.id}
                          preload={photos[1] && !photos[1].src ? [photos[1].id] : undefined}
                          src={cover.src}
                          alt=""
                          loading="lazy"
                        />
                        {photos[1]?.src && (
                          <img
                            className="album-card__peek"
                            src={photos[1].src}
                            alt=""
                            loading="lazy"
                          />
                        )}
                      </>
                    ) : (
                      <span className="album-card__empty">
                        <Icon name="image-plus" size={28} />
                      </span>
                    )}
                    {album.library !== undefined && (
                      <span className="album-card__badge" data-testid="shared-badge">
                        <Icon name="users" size={12} /> Shared with you
                      </span>
                    )}
                  </span>
                  <span className="album-card__title">{album.title}</span>
                  <span className="album-card__meta">
                    {photos.length + files.length === 0
                      ? 'Empty'
                      : `${photosAndFiles([...photos, ...files])}${range ? ` · ${range}` : ''}`}
                  </span>
                  {sharedLine(album) && (
                    <span className="album-card__shared">
                      <Icon name="users" size={14} />
                      {sharedLine(album)}
                    </span>
                  )}
                </Link>
                <AlbumActions album={album} className="album-card__menu" />
              </li>
            );
          })}
          {smart.map((album) => (
            <SmartAlbumCard key={album.id} album={album} />
          ))}
        </ul>
        {tab === 'all' && (
          <Link to={paths.favorites} className="albums__trash albums__favorites">
            <Icon name="heart" size={18} />
            <span className="albums__trash-title">Favorites</span>
            <Icon name="chevron-right" size={18} />
          </Link>
        )}
      </div>

      <Dialog open={creating} onClose={closeCreate} title="New album">
        <form className="form" onSubmit={onCreate} noValidate>
          <TextField
            label="Album name"
            placeholder="Our trip to…"
            autoFocus
            value={title}
            maxLength={80}
            onChange={(event) => {
              setTitle(event.currentTarget.value);
              setError(null);
            }}
            error={error}
          />
          <div className="dialog__actions">
            <button type="button" className="btn btn--ghost" onClick={closeCreate}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
              Create album
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/** A smart album's card: its photos are found again on this device. */
function SmartAlbumCard({ album }: { album: SmartAlbum }) {
  const { state } = useVault();
  const answer = useSmartAlbum(album);
  const ids = [...(answer?.found?.best ?? []), ...(answer?.found?.more ?? [])];
  const cover = state.photos.find((photo) => photo.id === ids[0]);
  return (
    <li className="album-grid__item">
      <Link to={paths.smartAlbum(album.id)} className="album-card">
        <span className="album-card__cover">
          {cover ? (
            <PhotoImage photoId={cover.id} src={cover.src} alt="" loading="lazy" />
          ) : (
            <span className="album-card__empty">
              <Icon name="search" size={28} />
            </span>
          )}
          <span className="album-card__badge" data-testid="smart-badge">
            <Icon name="sparkle" size={12} /> Smart
          </span>
        </span>
        <span className="album-card__title">{album.title}</span>
        <span className="album-card__meta">
          {answer?.found ? pluralize(ids.length, 'photo') : 'Fills itself as photos are added'}
        </span>
      </Link>
    </li>
  );
}

/** Who an album is shared with or by, for its card. */
function sharedLine(album: Album): string | null {
  if (album.library !== undefined) {
    return `From ${album.library}${isViewOnly(album) ? ' · view only' : ''}`;
  }
  if (album.sharedWith && album.sharedWith.length > 0) {
    return `Shared with ${album.sharedWith.join(', ')}`;
  }
  return null;
}
