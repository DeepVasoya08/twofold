import { useDownloads } from './downloads';
import { useImports } from './imports';
import { useUploads } from './uploads';

/** True while photos are uploading, importing or downloading in this tab. */
export function useTransfersRunning(): boolean {
  const uploads = useUploads();
  const downloads = useDownloads();
  const imports = useImports();
  return uploads.running || downloads.running || imports.running;
}

/**
 * Shown when a new main password or recovery key would start while photos are on the move: the
 * main library moves to a new id, and transfers still using the old one would fail.
 */
export const WAIT_FOR_TRANSFERS = 'Wait for uploads, imports and downloads to finish first.';
