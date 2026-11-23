import { useCallback, useRef, useState } from 'react';

import { errorMessage } from '@arcafold/core/errors';
import type { Photo } from '@arcafold/core/library/model';

import { openInApp } from '../../modules/save-file';
import type { Library } from './use-library';

export const NO_APP = 'No app on this phone opens this kind of file. Save it to the phone instead.';

/**
 * Opening a file in another app (a PDF reader, say): its original is downloaded and
 * decrypted into memory and handed over from there, so no decrypted copy lands on disk.
 * `opening` is the file on its way, if one is.
 */
export function useOpenFile(
  library: Pick<Library, 'original'>,
  say: (text: string) => void,
): { opening: string | null; open: (item: Photo) => void } {
  const [opening, setOpening] = useState<string | null>(null);
  const busy = useRef(false);
  const { original } = library;
  const open = useCallback(
    (item: Photo) => {
      if (busy.current) return;
      busy.current = true;
      setOpening(item.id);
      original(item.id)
        .then(async (file) => {
          const opened = await openInApp({
            bytes: file.full,
            name: file.name ?? item.file?.name ?? 'File',
            type: file.type,
          });
          if (!opened) say(NO_APP);
        })
        .catch((error: unknown) => {
          say(errorMessage(error));
        })
        .finally(() => {
          busy.current = false;
          setOpening(null);
        });
    },
    [original, say],
  );
  return { opening, open };
}
