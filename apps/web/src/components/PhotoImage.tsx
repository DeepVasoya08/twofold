import type { ComponentProps } from 'react';

/**
 * A photo's image, or a quiet placeholder while it is still being downloaded and decrypted.
 */
export function PhotoImage({ src, className, alt, ...rest }: ComponentProps<'img'>) {
  if (!src) {
    return (
      <span className={`photo-placeholder${className ? ` ${className}` : ''}`} aria-hidden="true" />
    );
  }
  return <img src={src} className={className} alt={alt} {...rest} />;
}
