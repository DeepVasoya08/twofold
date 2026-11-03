import { fileExtension, fileKindOf } from '../lib/file-types';
import type { FileDetails } from '../mock/data';
import { Icon } from './Icon';

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
