import { useEffect, useState } from 'react';

import { isNewerBuildLive, loadedEntryScript } from '../lib/app-version';
import { onVisibleAgain } from '../lib/when-visible';
import { Icon } from './Icon';

import './upload-progress.css';

/** How often an open tab checks for a newer Arcafold while it stays in view. */
const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * True once a newer Arcafold is live than the one this page loaded. Checks when the tab
 * comes back into view, every hour, and when part of the app fails to load (which is how
 * a tab left open across deploys notices first). Only in a built app.
 */
function useNewerBuild(): boolean {
  const [newer, setNewer] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD || newer) return;
    const loaded = loadedEntryScript();
    let stopped = false;
    const check = () => {
      void isNewerBuildLive(loaded).then((found) => {
        if (found && !stopped) setNewer(true);
      });
    };
    const stopWatching = onVisibleAgain(check);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    window.addEventListener('vite:preloadError', check);
    return () => {
      stopped = true;
      stopWatching();
      window.clearInterval(timer);
      window.removeEventListener('vite:preloadError', check);
    };
  }, [newer]);

  return newer;
}

/** A card asking for a reload once a newer Arcafold is live. */
export function UpdateCard() {
  const newer = useNewerBuild();
  if (!newer) return null;
  return (
    <section className="upload-progress upload-progress--static" aria-label="Update">
      <Icon name="info" size={18} />
      <span className="upload-progress__body">
        <span className="upload-progress__label">Arcafold has been updated</span>
        <span className="upload-progress__hint">
          Reload to keep everything working. You’ll unlock again after.
        </span>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload
        </button>
      </span>
    </section>
  );
}
