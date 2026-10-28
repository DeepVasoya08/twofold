/**
 * Finds faces in every photo that has no face results yet, in the background while the
 * vault is unlocked (see background-scan.ts).
 */
import { runBackgroundScan } from '../background-scan';
import type { BackgroundScanDeps, ScanEnd } from '../background-scan';
import type { FaceFinder } from './face-finder';
import { FinderStopped } from './face-finder';
import { ModelError } from './models';
import type { StoredFace } from './segment';

export { RETRY_MS, SAVE_EVERY, SCAN_BATCH } from '../background-scan';
export type { ScanEnd } from '../background-scan';

export type ScanDeps = Omit<
  BackgroundScanDeps<StoredFace[]>,
  'looker' | 'empty' | 'explain' | 'saveFailed'
> & { finder: FaceFinder };

function explain(error: unknown): string | null {
  if (error instanceof FinderStopped) return null;
  if (error instanceof ModelError) return error.message;
  return 'Finding faces stopped. It will try again next time you unlock.';
}

export function runScan({ finder, ...deps }: ScanDeps): Promise<ScanEnd> {
  return runBackgroundScan({
    ...deps,
    looker: {
      look: (image) => finder.find(image),
      stop: () => {
        finder.stop();
      },
    },
    // A preview that's missing or can't be read has no faces to find.
    empty: [],
    explain,
    saveFailed: 'Some face results couldn’t be saved. They’ll be found again later.',
  });
}
