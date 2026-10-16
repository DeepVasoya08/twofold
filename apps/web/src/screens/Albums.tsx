import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { Link, useRouter } from '../app/router';
import { paths } from '../app/routes';
import { useToast } from '../app/toast';
import { albumCover, albumPhotos, useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { Dialog } from '../components/Dialog';
import { TextField } from '../components/Field';
import { Icon } from '../components/Icon';
import { formatDateRange, pluralize } from '../lib/format';

import './albums.css';

/** URL-safe id for a new album. Mock only: real ids will be random and assigned by the API. */
export function albumIdFromTitle(title: string, taken: readonly string[]): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'album';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${String(n)}`;
  return id;
}

export function Albums() {
  const { state, dispatch } = useVault();
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
    const id = albumIdFromTitle(
      name,
      state.albums.map((album) => album.id),
    );
    dispatch({ type: 'create-album', album: { id, title: name } });
    toast.show(`“${name}” created`);
    closeCreate();
    navigate(paths.album(id));
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
            <li key={album.id}>
              <Link to={paths.album(album.id)} className="album-card">
                <span className="album-card__cover">
                  {cover ? (
                    <>
                      <img src={cover.src} alt="" loading="lazy" />
                      {photos[1] && (
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
            <button type="submit" className="btn btn--primary">
              Create album
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
