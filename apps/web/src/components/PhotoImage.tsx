import { useCallback, useEffect, useState } from 'react';
import type { ComponentProps } from 'react';

import { useRequestThumbs } from '../app/vault';
import { whenNearScreen } from '../lib/near-screen';

interface PhotoImageProps extends ComponentProps<'img'> {
  /** The photo shown, so its preview is downloaded once it comes near the screen. */
  photoId?: string | undefined;
  /** Other photos whose previews this image's spot also needs (an album card's second photo). */
  preload?: readonly string[] | undefined;
}

/**
 * A photo's image, or a quiet placeholder while it is still being downloaded and decrypted.
 * With a `photoId`, the preview is only asked for when the image is near the screen.
 */
export function PhotoImage({
  src,
  className,
  alt,
  photoId,
  preload,
  ref,
  ...rest
}: PhotoImageProps) {
  const requestThumbs = useRequestThumbs();
  const [element, setElement] = useState<Element | null>(null);
  const attach = useCallback(
    (node: HTMLImageElement | HTMLSpanElement | null) => {
      setElement(node);
      if (typeof ref === 'function') ref(node as HTMLImageElement | null);
      else if (ref) ref.current = node as HTMLImageElement | null;
    },
    [ref],
  );
  const needed = [...(src || !photoId ? [] : [photoId]), ...(preload ?? [])].join(',');

  useEffect(() => {
    if (!element || !needed) return;
    return whenNearScreen(element, () => {
      requestThumbs(needed.split(','));
    });
  }, [element, needed, requestThumbs]);

  if (!src) {
    return (
      <span
        ref={attach}
        className={`photo-placeholder${className ? ` ${className}` : ''}`}
        aria-hidden="true"
      />
    );
  }
  return <img ref={attach} src={src} className={className} alt={alt} {...rest} />;
}
