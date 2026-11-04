import { fileExtension, fileKindOf } from '@arcafold/core/file-types';
import type { FileDetails, Photo } from '../mock/data';
import { Icon } from './Icon';
import { PhotoImage } from './PhotoImage';

import './file-icon.css';

/**
 * A file's stand-in picture: a page with its extension on it, coloured by what kind of file
 * it is. Drawn from the file's name and type only; the file itself is never opened.
 */
export function FileIcon({ file, size = 'md' }: { file: FileDetails; size?: 'md' | 'lg' }) {
  const kind = fileKindOf(file.type, file.name);
  const extension = fileExtension(file.name).slice(0, 4).toUpperCase();
  return (
    <span className={`file-icon file-icon--${kind} file-icon--${size}`} aria-hidden="true">
      <Icon name="file" size={size === 'lg' ? 34 : 22} />
      {extension && <span className="file-icon__ext">{extension}</span>}
    </span>
  );
}

/**
 * A file's picture: its preview (a PDF's first page) when it has one, fetched once it comes
 * near the screen, and its icon otherwise.
 */
export function FileThumb({ item, size = 'md' }: { item: Photo; size?: 'md' | 'lg' }) {
  const file = item.file;
  if (!file) return null;
  if (!file.preview) return <FileIcon file={file} size={size} />;
  return (
    <span className={`file-thumb file-thumb--${size}`} aria-hidden="true">
      <PhotoImage photoId={item.id} src={item.src} alt="" loading="lazy" decoding="async" />
    </span>
  );
}
