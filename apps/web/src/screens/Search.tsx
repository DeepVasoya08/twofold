import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { useFind } from '../app/find';
import { notLookedAtLine, notReadyLine } from '@arcafold/core/search/answer';
import { Link, useRouter } from '../app/router';
import { paths } from '../app/routes';
import { useSearch } from '../app/search';
import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { FileResults } from '../components/FileResults';
import { TextField } from '../components/Field';
import { Icon } from '../components/Icon';
import { PhotoGrid } from '../components/PhotoGrid';
import { findFiles } from '../lib/file-sort/match';
import { pluralize } from '../lib/format';
import type { ParsedQuery } from '@arcafold/core/search/query';
import { SEARCH_RESOURCES } from '../lib/search/resources';
import { MAX_SMART_TITLE, smartAlbumFits, suggestTitle } from '@arcafold/core/search/smart-album';
import { errorMessage } from '@arcafold/core/errors';
import type { Photo } from '@arcafold/core/library/model';

import './search.css';

/** The text half and its word list, in MB, for the first search's download. */
export const QUERY_DOWNLOAD_MB = Math.round(
  (SEARCH_RESOURCES.text.size + SEARCH_RESOURCES.words.size) / 1_000_000,
);

export { notLookedAtLine, notReadyLine } from '@arcafold/core/search/answer';

export function Search() {
  const find = useFind();
  const search = useSearch();
  const { state } = useVault();
  const [saving, setSaving] = useState(false);
  const { query, found, words } = find;
  const byId = new Map(state.photos.map((photo) => [photo.id, photo]));
  const photosFor = (ids: readonly string[]): Photo[] =>
    ids.flatMap((id) => {
      const photo = byId.get(id);
      return photo ? [photo] : [];
    });
  const best = photosFor(found?.best ?? []);
  const more = photosFor(found?.more ?? []);
  const hasWords = (query?.what ?? '') !== '';
  const looksAlike = query !== null && (query.like !== null || query.taught.length > 0);
  const notIndexed = search.progress.total - search.progress.done;
  // Files are found by their names and words on this device, whatever Smart search does.
  const files =
    query && find.saved
      ? findFiles(
          (state.files ?? []).filter((item) => !item.sharedAlbum),
          find.saved.text,
          query,
        )
      : [];

  return (
    <div className="page">
      <PageHeader title="Search" subtitle="Searches run on this device and aren’t saved." />

      {!query && (
        <EmptyState icon="search" title="Search your photos and files">
          Type in the search box above, from any screen. Try a place, a person, a date, what’s in
          the photo, or a file’s name.
        </EmptyState>
      )}

      {query && query.chips.length > 0 && (
        <ul className="search-chips" aria-label="What the search looked for">
          {query.chips.map((chip) => (
            <li key={chip.key}>
              <button
                type="button"
                className="search-chip"
                aria-label={`Stop looking for ${chip.label}`}
                onClick={() => {
                  find.toggleChip(chip.key);
                }}
              >
                {chip.label}
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {query?.needsMe && (
        <p className="search-note">
          To search for yourself, open your photos in <Link to={paths.people}>People</Link> and
          choose “This is me”.
        </p>
      )}
      {(hasWords || looksAlike) && find.wordsOff === 'off' && (
        <p className="search-note">
          Smart search is off on this device, so photos can’t be found by what’s in them. You can
          turn it on in <Link to={paths.settings}>Settings</Link>.
        </p>
      )}
      {hasWords && find.wordsOff === 'unavailable' && (
        <p className="search-note">Photos can’t be found by what’s in them here.</p>
      )}
      {search.enabled &&
        search.status !== 'loading' &&
        (find.notLookedAt.photo || find.notLookedAt.words.length > 0) && (
          <p className="search-note">{notLookedAtLine(find.notLookedAt)}</p>
        )}
      {words.state === 'downloading' && (
        <div className="search-note" role="status">
          <span>
            Downloading resources for search, about {QUERY_DOWNLOAD_MB} MB the first time (
            {Math.floor((words.received / Math.max(1, words.total)) * 100)}%)
          </span>
          <progress max={words.total} value={words.received} aria-label="Download progress" />
        </div>
      )}
      {words.state === 'working' && (
        <p className="search-note" role="status">
          Searching…
        </p>
      )}
      {words.state === 'failed' && (
        <div className="search-note" role="alert">
          <span>{words.message}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={find.retry}>
            Try again
          </button>
        </div>
      )}

      {found && search.enabled && (
        <button
          type="button"
          className="btn btn--secondary btn--sm search-save"
          onClick={() => {
            setSaving(true);
          }}
        >
          <Icon name="album-add" size={16} />
          Save as album
        </button>
      )}

      {files.length > 0 && <FileResults files={files} />}

      {found && (
        <>
          {best.length === 0 && more.length === 0 ? (
            files.length > 0 ? null : (
              <EmptyState icon="search" title="No matches">
                Try other words, or tap a part of the search above to leave it out.
              </EmptyState>
            )
          ) : (
            <>
              <p className="search-count" role="status">
                {best.length > 0
                  ? pluralize(best.length, 'best match', 'best matches')
                  : 'No clear matches. These might be close:'}
              </p>
              <PhotoGrid photos={photosFor(find.shownIds)} context={{ kind: 'search' }} />
              {best.length > 0 && more.length > 0 && !find.showMore && (
                <button
                  type="button"
                  className="btn btn--secondary search-more"
                  onClick={() => {
                    find.setShowMore(true);
                  }}
                >
                  Show {more.length.toLocaleString('en-US')} more
                </button>
              )}
            </>
          )}
          {(hasWords || looksAlike) && Math.max(found.notReady, notIndexed) > 0 && (
            <p className="search-note">{notReadyLine(Math.max(found.notReady, notIndexed))}</p>
          )}
        </>
      )}
      {query && find.saved && (
        <SaveSearchDialog
          open={saving}
          query={query}
          saved={find.saved}
          wordsVector={find.wordsVector}
          onClose={() => {
            setSaving(false);
          }}
        />
      )}
    </div>
  );
}

/** Saves the search on screen as a smart album, which fills itself from then on. */
function SaveSearchDialog({
  open,
  query,
  saved,
  wordsVector,
  onClose,
}: {
  open: boolean;
  query: ParsedQuery;
  saved: { text: string; ignore: string[]; like: string | null };
  wordsVector: Float32Array | null;
  onClose: () => void;
}) {
  const search = useSearch();
  const toast = useToast();
  const { navigate } = useRouter();
  const [title, setTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shownTitle = title ?? suggestTitle(query.chips);

  const close = () => {
    setTitle(null);
    setError(null);
    onClose();
  };

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const name = shownTitle.trim();
    if (!name) {
      setError('Give your album a name.');
      return;
    }
    const fresh = {
      title: name,
      ...saved,
      savedAt: new Date().toISOString(),
      what: query.what,
      vector: query.what ? wordsVector : null,
    };
    if (!smartAlbumFits({ ...fresh, id: '' })) {
      setError('This search is too long to save as an album.');
      return;
    }
    if (busy) return;
    setBusy(true);
    search
      .saveSmartAlbum(fresh)
      .then(
        (stored) => {
          toast.show(`“${stored.title}” saved to Albums`);
          close();
          navigate(paths.smartAlbum(stored.id));
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
    <Dialog
      open={open}
      onClose={close}
      title="Save as album"
      description="A smart album fills itself with photos that match this search, as they’re added. It runs on this device, and the search is saved encrypted."
    >
      <form className="form" onSubmit={onSubmit} noValidate>
        <TextField
          label="Album name"
          autoFocus
          value={shownTitle}
          maxLength={MAX_SMART_TITLE}
          onChange={(event) => {
            setTitle(event.currentTarget.value);
            setError(null);
          }}
          error={error}
        />
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
