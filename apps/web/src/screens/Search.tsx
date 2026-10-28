import { useFind } from '../app/find';
import type { NotLookedAt } from '../app/find';
import { Link } from '../app/router';
import { paths } from '../app/routes';
import { useSearch } from '../app/search';
import { useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { PhotoGrid } from '../components/PhotoGrid';
import { pluralize } from '../lib/format';
import { SEARCH_RESOURCES } from '../lib/search/resources';
import type { Photo } from '../mock/data';

import './search.css';

/** The text half and its word list, in MB, for the first search's download. */
export const QUERY_DOWNLOAD_MB = Math.round(
  (SEARCH_RESOURCES.text.size + SEARCH_RESOURCES.words.size) / 1_000_000,
);

export function notReadyLine(count: number): string {
  return `${pluralize(count, 'photo')} ${count === 1 ? 'isn’t' : 'aren’t'} ready to search by what’s in ${count === 1 ? 'it' : 'them'} yet.`;
}

/** Why a search for photos that look like others can't run yet. */
export function notLookedAtLine({ photo, words }: NotLookedAt): string {
  const later = 'Smart search looks at photos in the background, so try again soon.';
  if (photo || words.length === 0) return `This photo hasn’t been looked at yet. ${later}`;
  const quoted = words.map((name) => `“${name}”`);
  const named =
    quoted.length === 1
      ? quoted.join('')
      : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1) ?? ''}`;
  return `The photos you taught ${named} with haven’t been looked at yet. ${later}`;
}

export function Search() {
  const find = useFind();
  const search = useSearch();
  const { state } = useVault();
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

  return (
    <div className="page">
      <PageHeader title="Search" subtitle="Searches run on this device and aren’t saved." />
      <form
        role="search"
        className="search-box"
        onSubmit={(event) => {
          event.preventDefault();
          find.submit();
        }}
      >
        <Icon name="search" size={18} />
        <input
          type="search"
          className="search-box__input"
          aria-label="Search your photos"
          placeholder="Try “beach”, “Estrella last year” or “us in December”"
          value={find.text}
          maxLength={300}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          onChange={(event) => {
            find.setText(event.currentTarget.value);
          }}
        />
        <button type="submit" className="btn btn--primary btn--sm">
          Search
        </button>
      </form>

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

      {found && (
        <>
          {best.length === 0 && more.length === 0 ? (
            <EmptyState icon="search" title="No matches">
              Try other words, or tap a part of the search above to leave it out.
            </EmptyState>
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
    </div>
  );
}
