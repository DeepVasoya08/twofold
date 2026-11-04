import { Link } from '../app/router';
import { paths } from '../app/routes';
import { categoryLabel } from '@arcafold/core/file-categories';
import { fileKindLabel, fileKindOf } from '@arcafold/core/file-types';
import { formatShortDay, pluralize } from '../lib/format';
import { FileThumb } from './FileIcon';
import type { Photo } from '@arcafold/core/library/model';

import '../screens/files.css';

/** Files a search found, as rows that open each one. */
export function FileResults({ files }: { files: readonly Photo[] }) {
  return (
    <section className="search-files" aria-labelledby="search-files-title">
      <h2 className="search-files__title" id="search-files-title">
        {pluralize(files.length, 'file')}
      </h2>
      <ul className="file-list" aria-label="Files found">
        {files.map((item) => {
          const file = item.file;
          const name = file?.name ?? 'File';
          const details = [
            file ? fileKindLabel(fileKindOf(file.type, file.name)) : 'File',
            formatShortDay(item.takenAt),
            ...(file?.category ? [categoryLabel(file.category)] : []),
          ].join(' · ');
          return (
            <li key={item.id} className="file-row">
              <Link to={paths.file(item.id)} className="file-row__main" aria-label={`Open ${name}`}>
                <FileThumb item={item} />
                <span className="file-row__text">
                  <span className="file-row__name">{name}</span>
                  <span className="file-row__meta">{details}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
