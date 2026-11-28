import type { UploadSource, Uploader, UploaderDeps } from '@arcafold/core/upload/uploader';

import type { Watching } from './background-uploads';

/** How one opening's uploads end as the library closes. */
export interface CloseUploads<Source extends UploadSource> {
  /** Whether they stop rather than finish: they do in the private space. */
  stop: boolean;
  /** What photos already on their way finish with: the same keys, and no new previews. */
  finishing: UploaderDeps<Source>;
  /** What the uploader is left with once it's done: nothing that works. */
  closed: UploaderDeps<Source>;
  /** Lets go of the keys, once nothing of this opening is followed any more. */
  done: () => void;
}

/**
 * Ends one opening's uploads as the library closes (on lock or sign-out).
 *
 * In the main library, photos already on their way still finish with the keys they started
 * with, which then go. They show in the timeline at the next unlock, and the notifications
 * follow them to the end.
 *
 * In the private space they stop at once: photos not yet sent are dropped, and the
 * notifications stop counting them and never say how they went, so whoever unlocks the main
 * library next finds nothing of them on the phone (a notice for photos the main library
 * doesn't have would give the private space away). Those already being sent (a few at most)
 * can't be called back: they finish quietly and show at the private space's next opening.
 */
export function closeUploads<Source extends UploadSource>(
  uploader: Uploader<Source>,
  watching: Watching,
  { stop, finishing, closed, done }: CloseUploads<Source>,
): void {
  const close = () => {
    uploader.dispose();
    uploader.connect(closed);
    watching.stop();
    done();
  };
  if (stop) {
    // Taken back first, so the list emptying doesn't read as the photos being in.
    watching.drop();
    close();
    return;
  }
  if (!uploader.running) {
    close();
    return;
  }
  uploader.connect(finishing);
  const unsubscribe = uploader.subscribe(() => {
    if (uploader.running) return;
    unsubscribe();
    close();
  });
}
