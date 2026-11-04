import { useCallback, useEffect, useRef, useState } from 'react';

import type { Session } from '@arcafold/core/account';
import type { Photo } from '@arcafold/core/library/model';
import { createThumbLoader } from '@arcafold/core/library/thumb-loader';
import type { ThumbLoader } from '@arcafold/core/library/thumb-loader';
import { sessionStore } from '@arcafold/core/sharing';

import { MemoryImages } from '../../modules/memory-image';

export interface Library {
  status: 'loading' | 'ready' | 'failed';
  photos: Photo[];
  /** Each preview that's ready: an id MemoryImage shows it by. */
  thumbs: ReadonlyMap<string, string>;
  /** Asks for photos' previews; those `onScreen` go first. Asking twice is free. */
  requestThumbs: (photoIds: readonly string[], onScreen?: boolean) => void;
  retry: () => void;
}

/**
 * The open space's photos, with previews downloaded and decrypted as they come near the
 * screen, the same way as on the web. Decrypted previews live only in native memory, and
 * all of them are wiped when the library closes (on lock or sign-out).
 */
export function useLibrary(session: Session): Library {
  const [status, setStatus] = useState<Library['status']>('loading');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string>>(new Map());
  const [attempt, setAttempt] = useState(0);
  const loader = useRef<ThumbLoader | null>(null);

  useEffect(() => {
    let stopped = false;
    const store = sessionStore(session.opened.space, session.account.name);
    const thumbLoader = createThumbLoader({
      fetch: (photoIds, onThumb) => store.thumbs(photoIds, onThumb),
      onReady: (urls) => {
        if (stopped) return;
        setThumbs((current) => new Map([...current, ...urls]));
      },
    });
    loader.current = thumbLoader;
    store.list().then(
      (loaded) => {
        if (stopped) return;
        setPhotos(loaded.photos);
        setStatus('ready');
      },
      () => {
        if (!stopped) setStatus('failed');
      },
    );
    return () => {
      stopped = true;
      loader.current = null;
      thumbLoader.stop();
      store.dispose();
      MemoryImages.clear();
    };
  }, [session, attempt]);

  const requestThumbs = useCallback((photoIds: readonly string[], onScreen?: boolean) => {
    loader.current?.request(photoIds, onScreen);
  }, []);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((count) => count + 1);
  }, []);

  return { status, photos, thumbs, requestThumbs, retry };
}
