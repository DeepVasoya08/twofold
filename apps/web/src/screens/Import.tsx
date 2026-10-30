import { STORAGE_SIZES } from '@twofold/types';
import { useEffect, useMemo, useRef, useState } from 'react';

import { errorMessage } from '../app/account-ops';
import { useImports } from '../app/imports';
import type { ImportJob } from '../app/importer';
import { Link } from '../app/router';
import { paths } from '../app/routes';
import { useStorageUsage } from '../app/storage';
import { useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { FormAlert } from '../components/FormAlert';
import { Icon } from '../components/Icon';
import { pluralize } from '../lib/format';
import type { Album } from '../mock/data';
import { collectSources } from '../lib/import/sources';
import { albumsOf, pickedItems, yearGroups, yearsThatFit } from '../lib/import/selection';
import { planTakeout } from '../lib/import/takeout';
import type { ImportPlan } from '../lib/import/takeout';
import { formatBytes } from '../lib/storage-usage';

import './share.css';
import '../components/upload-dialog.css';
import './import.css';

const TAKEOUT_URL = 'https://takeout.google.com/';

/** Picks Takeout zips, or the folder they were unzipped into. */
function ChooseExport({ onChosen }: { onChosen: (files: File[]) => void }) {
  const zipInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  // React doesn't know the folder picker's attribute, so it's set here.
  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '');
  }, []);

  return (
    <div className="import">
      <ol className="import__steps">
        <li>
          Go to{' '}
          <a href={TAKEOUT_URL} target="_blank" rel="noreferrer noopener">
            Google Takeout
          </a>
          , click <strong>Deselect all</strong>, then tick <strong>Google Photos</strong>.
        </li>
        <li>
          Choose <strong>.zip</strong> files and the biggest file size, then create the export.
        </li>
        <li>When Google emails you, download every zip, then choose them here.</li>
      </ol>
      <p className="share__note">
        <Icon name="shield" size={16} />
        Your export is opened on this device. Each photo is encrypted here before it’s uploaded, and
        the zips never leave this device.
      </p>
      <div className="import__choose">
        <button
          type="button"
          className="btn btn--primary btn--lg"
          onClick={() => zipInput.current?.click()}
        >
          Choose zip files
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--lg"
          onClick={() => folderInput.current?.click()}
        >
          Choose a folder
        </button>
      </div>
      <input
        ref={zipInput}
        className="visually-hidden"
        type="file"
        accept=".zip,application/zip"
        multiple
        tabIndex={-1}
        aria-label="Choose Takeout zip files"
        onChange={(event) => {
          onChosen([...(event.currentTarget.files ?? [])]);
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={folderInput}
        className="visually-hidden"
        type="file"
        multiple
        tabIndex={-1}
        aria-label="Choose an unzipped Takeout folder"
        onChange={(event) => {
          onChosen([...(event.currentTarget.files ?? [])]);
          event.currentTarget.value = '';
        }}
      />
    </div>
  );
}

/** What's in the export, and which years to bring in. */
function ReviewPlan({ plan, onCancel }: { plan: ImportPlan; onCancel: () => void }) {
  const vault = useVault();
  const imports = useImports();
  const used = useStorageUsage();
  const free = Math.max(0, STORAGE_SIZES.accountQuota - used);
  const groups = useMemo(() => yearGroups(plan.items), [plan.items]);
  const [years, setYears] = useState(() => yearsThatFit(groups, free));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picked = useMemo(() => pickedItems(plan.items, years), [plan.items, years]);
  const pickedBytes = groups
    .filter((group) => years.has(group.year))
    .reduce((total, group) => total + group.bytes, 0);
  const albums = albumsOf(picked, plan.albums);
  const tooBig = pickedBytes > free;

  const toggle = (year: number | null, on: boolean) => {
    setYears((current) => {
      const next = new Set(current);
      if (on) next.add(year);
      else next.delete(year);
      return next;
    });
  };

  const onStart = () => {
    if (busy || tooBig || picked.length === 0) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        // Albums are made first, or found by title if they're already here from an earlier go.
        const made = new Map<string, Album>();
        for (const title of albums) {
          const existing = vault.state.albums.find(
            (album) => album.library === undefined && album.title === title,
          );
          made.set(title, existing ?? (await vault.createAlbum(title)));
        }
        const jobs: ImportJob[] = picked.map((item) => ({
          item,
          albums: item.albums.flatMap((title) => {
            const album = made.get(title);
            return album ? [album] : [];
          }),
        }));
        imports.start(jobs);
      } catch (caught) {
        setError(errorMessage(caught));
        setBusy(false);
      }
    })();
  };

  return (
    <div className="import">
      <p className="import__summary">
        Found {pluralize(plan.items.length, 'photo')}
        {plan.albums.length > 0 && <> in {pluralize(plan.albums.length, 'album')}</>}.
        {plan.videos > 0 && (
          <>
            {' '}
            {pluralize(plan.videos, 'video')} will be skipped, as Twofold can’t store videos yet.
          </>
        )}
      </p>
      <fieldset className="import__years">
        <legend>Years to import</legend>
        {groups.map((group) => {
          const label = group.year === null ? 'Not in a year' : String(group.year);
          return (
            <label key={label} className="checkbox import__year">
              <input
                type="checkbox"
                checked={years.has(group.year)}
                disabled={busy}
                onChange={(event) => {
                  toggle(group.year, event.currentTarget.checked);
                }}
              />
              <span className="import__year-name">{label}</span>
              <span className="import__year-size">
                {pluralize(group.count, 'photo')} · {formatBytes(group.bytes)}
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className={`import__fit${tooBig ? ' is-over' : ''}`} role="status">
        {tooBig
          ? `That’s about ${formatBytes(pickedBytes)}, more than the ${formatBytes(free)} you have free. Pick fewer years.`
          : `About ${formatBytes(pickedBytes)} of the ${formatBytes(free)} you have free.`}
        {albums.length > 0 && !tooBig && ` ${pluralize(albums.length, 'album')} will be made too.`}
      </p>
      <FormAlert message={error} />
      <div className="import__choose">
        <button
          type="button"
          className="btn btn--primary btn--lg"
          disabled={busy || tooBig || picked.length === 0}
          aria-busy={busy}
          onClick={onStart}
        >
          {picked.length === 0 ? 'Import' : `Import ${pluralize(picked.length, 'photo')}`}
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--lg"
          disabled={busy}
          onClick={onCancel}
        >
          Choose another export
        </button>
      </div>
    </div>
  );
}

/** The import going on, or how it went. */
function ImportStatus({ onAgain }: { onAgain: () => void }) {
  const imports = useImports();
  const handled = imports.imported + imports.already + imports.failures.length;
  const percent = imports.total === 0 ? 0 : Math.round((handled / imports.total) * 100);

  if (imports.running) {
    return (
      <div className="import">
        <p className="import__summary" role="status">
          {handled.toLocaleString('en-US')} of {pluralize(imports.total, 'photo')}
          {imports.stopped ? ', stopping…' : ''}
        </p>
        <span
          className="progress"
          role="progressbar"
          aria-label="Import progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span className="progress__bar" style={{ width: `${String(percent)}%` }} />
        </span>
        <p className="share__note">
          <Icon name="info" size={16} />
          You can keep using Twofold while this runs. Keep this tab open: closing it stops the
          import, and starting again later skips photos already brought in.
        </p>
        <div className="import__choose">
          <button
            type="button"
            className="btn btn--secondary btn--lg"
            disabled={imports.stopped}
            onClick={imports.stop}
          >
            Stop
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="import">
      <p className="import__summary" role="status">
        {imports.stopped ? 'Import stopped. ' : 'Import finished. '}
        {pluralize(imports.imported, 'photo')} imported
        {imports.already > 0 && <>, {imports.already.toLocaleString('en-US')} already here</>}.
      </p>
      {imports.failures.length > 0 && (
        <details className="import__failures">
          <summary>{pluralize(imports.failures.length, 'photo')} couldn’t be imported</summary>
          <ul>
            {imports.failures.map((failure, index) => (
              <li key={`${failure.name}-${String(index)}`}>
                <span>{failure.name}</span>: {failure.error}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="import__choose">
        <Link to={paths.gallery} className="btn btn--primary btn--lg">
          See photos
        </Link>
        <button type="button" className="btn btn--secondary btn--lg" onClick={onAgain}>
          Import more
        </button>
      </div>
    </div>
  );
}

/**
 * Bringing photos in from a Google Photos export (Google Takeout). The zips are read on this
 * device; each photo goes through the same encryption as an upload, into the open space,
 * with its date and albums kept. Photos already here are skipped.
 */
export function Import() {
  const { space } = useVault();
  const imports = useImports();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const where = space === 'private' ? 'private space' : 'library';

  const onChosen = (files: File[]) => {
    if (files.length === 0) return;
    setReading(true);
    setError(null);
    collectSources(files)
      .then((sources) => {
        const found = planTakeout(sources);
        if (found.items.length === 0) {
          setError(
            found.videos > 0
              ? 'This export only has videos, which Twofold can’t store yet.'
              : 'No photos were found. Choose the zips from Google Takeout, or the folder they were unzipped into.',
          );
          return;
        }
        setPlan(found);
      })
      .catch((caught: unknown) => {
        setError(errorMessage(caught));
      })
      .finally(() => {
        setReading(false);
      });
  };

  const started = imports.phase !== 'idle';
  let body;
  if (started) {
    body = (
      <ImportStatus
        onAgain={() => {
          imports.reset();
          setPlan(null);
        }}
      />
    );
  } else if (reading) {
    body = (
      <p className="import__summary" role="status">
        Reading your export…
      </p>
    );
  } else if (plan) {
    body = (
      <ReviewPlan
        plan={plan}
        onCancel={() => {
          setPlan(null);
        }}
      />
    );
  } else {
    body = (
      <>
        <FormAlert message={error} />
        <ChooseExport onChosen={onChosen} />
      </>
    );
  }

  return (
    <div className="page page--narrow">
      <PageHeader
        title="Import from Google Photos"
        subtitle={`Bring your photos and albums into your ${where}, with the dates they were taken.`}
        back={{ to: paths.settings, label: 'Settings' }}
      />
      <div className="share-card">{body}</div>
    </div>
  );
}
