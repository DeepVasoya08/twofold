import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { errorMessage } from '../app/account-ops';
import { Link, useRouter } from '../app/router';
import { paths } from '../app/routes';
import { useToast } from '../app/toast';
import { albumCover, albumPhotos, useVault } from '../app/vault';
import { AlbumActions } from '../components/AlbumActions';
import { PageHeader } from '../components/AppShell';
import { Dialog } from '../components/Dialog';
import { TextField } from '../components/Field';
import { Icon } from '../components/Icon';
import { PhotoImage } from '../components/PhotoImage';
import { formatDateRange, pluralize } from '../lib/format';

import './albums.css';

export function Albums() {
  const { state, createAlbum } = useVault();
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
        subtitle={pluralize(state.albums.length, 'album')}
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

      <ul className="album-grid">
        {state.albums.map((album) => {
          const photos = albumPhotos(state, album.id);
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
                </span>
                <span className="album-card__title">{album.title}</span>
                <span className="album-card__meta">
                  {photos.length === 0
                    ? 'Empty'
                    : `${pluralize(photos.length, 'photo')}${range ? ` · ${range}` : ''}`}
                </span>
              </Link>
              <AlbumActions album={album} className="album-card__menu" />
            </li>
          );
        })}
      </ul>

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
