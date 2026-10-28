import type { ReactNode } from 'react';

import { useSearch } from '../app/search';
import { SEARCH_RESOURCES } from '../lib/search/resources';
import { Icon } from './Icon';

import './upload-dialog.css';
import './upload-progress.css';

/** About how much Smart search downloads to look at photos, in MB. */
export const SEARCH_DOWNLOAD_MB = Math.round(SEARCH_RESOURCES.photo.size / 1_000_000);

/**
 * A small card while Smart search gets its resources: waiting for Wi-Fi on a phone (with
 * "Download now"), downloading (with Pause), paused, or failed (with Try again). Nothing
 * shows while photos are looked at; Settings has the progress.
 */
export function SmartSearchCard() {
  const search = useSearch();
  const { download } = search;

  if (search.status === 'failed' && search.error) {
    return (
      <Card label="Smart search stopped" hint={search.error} failed>
        <button type="button" className="btn btn--secondary btn--sm" onClick={search.retry}>
          Try again
        </button>
      </Card>
    );
  }
  if (download.state === 'waiting-for-wifi') {
    return (
      <Card
        label="Smart search is waiting for Wi-Fi"
        hint={`It needs to download some resources (about ${String(SEARCH_DOWNLOAD_MB)} MB) once.`}
      >
        <button type="button" className="btn btn--secondary btn--sm" onClick={search.downloadNow}>
          Download now
        </button>
      </Card>
    );
  }
  if (download.state === 'paused') {
    return (
      <Card label="Smart search is paused" hint="Downloading resources will carry on.">
        <button type="button" className="btn btn--secondary btn--sm" onClick={search.resume}>
          Resume
        </button>
      </Card>
    );
  }
  if (download.state === 'downloading') {
    const percent = Math.floor((download.received / download.total) * 100);
    return (
      <Card label="Downloading resources for Smart search">
        <span
          className="progress"
          role="progressbar"
          aria-label="Smart search download"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span className="progress__bar" style={{ width: `${String(percent)}%` }} />
        </span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={search.pause}>
          Pause
        </button>
      </Card>
    );
  }
  return null;
}

function Card({
  label,
  hint,
  failed = false,
  children,
}: {
  label: string;
  hint?: string;
  failed?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`upload-progress upload-progress--static${failed ? ' is-failed' : ''}`}
      aria-label="Smart search"
    >
      <Icon name="sparkle" size={18} />
      <span className="upload-progress__body">
        <span className="upload-progress__label">{label}</span>
        {hint ? <span className="upload-progress__hint">{hint}</span> : null}
        {children}
      </span>
    </section>
  );
}
