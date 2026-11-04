import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { useSmartAlbum } from '../app/answer';
import { Link, useRouter } from '../app/router';
import { paths } from '../app/routes';
import { useSearch } from '../app/search';
import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { TextField } from '../components/Field';
import { Menu } from '../components/Menu';
import type { MenuItem } from '../components/Menu';
import { PhotoGrid } from '../components/PhotoGrid';
import { pluralize } from '../lib/format';
import { MAX_SMART_TITLE } from '@arcafold/core/search/smart-album';
import { notLookedAtLine, notReadyLine } from './Search';
import { errorMessage } from '@arcafold/core/errors';
import type { Photo } from '@arcafold/core/library/model';

import './search.css';

/**
 * A search saved as an album. It runs again each time it's opened, over the photos looked
 * at so far, so new photos that match show up on their own.
 */
export function SmartAlbumView({ albumId }: { albumId: string }) {
  const search = useSearch();
  const { state } = useVault();
  const { navigate } = useRouter();
  const toast = useToast();
  const album = search.smartAlbums.find((each) => each.id === albumId);
  const answer = useSmartAlbum(album);
  const [showMore, setShowMore] = useState(false);
  const [open, setOpen] = useState<'rename' | 'delete' | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!album || !answer) {
    // Smart albums arrive with the rest of Smart search's data.
    if (search.status === 'loading') return <div className="page" />;
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
          It may have been deleted, or Smart search is off on this device.
        </EmptyState>
      </div>
    );
  }

  const byId = new Map(state.photos.map((photo) => [photo.id, photo]));
  const photosFor = (ids: readonly string[]): Photo[] =>
    ids.flatMap((id) => {
      const photo = byId.get(id);
      return photo ? [photo] : [];
    });
  const { found, notLookedAt, query, changed } = answer;
  const best = found?.best ?? [];
  const more = found?.more ?? [];
  const shown = photosFor(best.length === 0 ? more : [...best, ...(showMore ? more : [])]);
  const looks = query.like !== null || query.taught.length > 0;
  const ranked = query.what !== '' || looks;
  const notIndexed = search.progress.total - search.progress.done;

  const run = (change: () => Promise<unknown>, done: string, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    change()
      .then(
        () => {
          toast.show(done);
          setOpen(null);
          after?.();
        },
        (caught: unknown) => {
          if (open === 'rename') setError(errorMessage(caught));
          else toast.show(errorMessage(caught));
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };

  const onRename = (event: SubmitEvent) => {
    event.preventDefault();
    const name = title.trim();
    if (!name) {
      setError('Give your album a name.');
      return;
    }
    run(() => search.saveSmartAlbum({ ...album, title: name }), `Renamed to “${name}”`);
  };

  const items: MenuItem[] = [
    {
      label: 'Rename',
      icon: 'pencil',
      onSelect: () => {
        setTitle(album.title);
        setError(null);
        setOpen('rename');
      },
    },
    {
      label: 'Delete album',
      icon: 'trash',
      danger: true,
      onSelect: () => {
        setOpen('delete');
      },
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title={album.title}
        subtitle={
          found ? `Smart album · ${pluralize(best.length + more.length, 'photo')}` : 'Smart album'
        }
        back={{ to: paths.albums, label: 'Albums' }}
        actions={<Menu label={`Actions for ${album.title}`} items={items} />}
      />
      <p className="search-note">
        Fills itself with photos that match, as they’re added. It runs on this device only.
      </p>
      {query.chips.length > 0 && (
        <ul className="search-chips" aria-label="What the album looks for">
          {query.chips.map((chip) => (
            <li key={chip.key}>
              <span className="search-chip search-chip--still">{chip.label}</span>
            </li>
          ))}
        </ul>
      )}

      {ranked && !search.enabled && (
        <p className="search-note">
          Smart search is off on this device, so this album can’t find photos by what’s in them. You
          can turn it on in <Link to={paths.settings}>Settings</Link>.
        </p>
      )}
      {changed && (
        <p className="search-note">
          Part of this album’s search reads differently now, after a word or name changed. Save the
          search again to update it.
        </p>
      )}
      {search.enabled &&
        search.status !== 'loading' &&
        (notLookedAt.photo || notLookedAt.words.length > 0) && (
          <p className="search-note">{notLookedAtLine(notLookedAt)}</p>
        )}

      {found &&
        (best.length === 0 && more.length === 0 ? (
          <EmptyState icon="albums" title="Nothing here yet">
            Photos that match show up here as they’re added and looked at.
          </EmptyState>
        ) : (
          <>
            <PhotoGrid photos={shown} context={{ kind: 'smart', albumId: album.id }} />
            {best.length > 0 && more.length > 0 && !showMore && (
              <button
                type="button"
                className="btn btn--secondary search-more"
                onClick={() => {
                  setShowMore(true);
                }}
              >
                Show {more.length.toLocaleString('en-US')} more
              </button>
            )}
          </>
        ))}
      {found && ranked && Math.max(found.notReady, notIndexed) > 0 && (
        <p className="search-note">{notReadyLine(Math.max(found.notReady, notIndexed))}</p>
      )}

      <Dialog
        open={open === 'rename'}
        onClose={() => {
          setOpen(null);
        }}
        title="Rename album"
      >
        <form className="form" onSubmit={onRename} noValidate>
          <TextField
            label="Album name"
            autoFocus
            value={title}
            maxLength={MAX_SMART_TITLE}
            onChange={(event) => {
              setTitle(event.currentTarget.value);
              setError(null);
            }}
            error={error}
          />
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setOpen(null);
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
              Save
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={open === 'delete'}
        onClose={() => {
          setOpen(null);
        }}
        title={`Delete “${album.title}”?`}
        description="Only the saved search is deleted. Its photos stay in your library."
      >
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setOpen(null);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              run(
                () => search.deleteSmartAlbum(album.id),
                `“${album.title}” deleted`,
                () => {
                  navigate(paths.albums, { replace: true });
                },
              );
            }}
          >
            Delete album
          </button>
        </div>
      </Dialog>
    </div>
  );
}
