import { Link } from '../app/router';
import { paths } from '../app/routes';
import type { PhotoContext } from '../app/routes';
import { dragProps } from './folder-drag';
import { categoryLabel } from '@arcafold/core/file-categories';
import type { Category } from '@arcafold/core/file-categories';
import { fileKindLabel, fileKindOf } from '@arcafold/core/file-types';
import { formatShortDay } from '../lib/format';
import { formatBytes } from '../lib/storage-usage';
import { FileThumb } from './FileIcon';
import { Menu } from './Menu';
import type { MenuItem } from './Menu';
import type { Photo } from '@arcafold/core/library/model';

import '../screens/files.css';

/** A file's details line: "PDF · 1.2 MB · 2 Nov", with its category and whose library. */
export function fileDetails(item: Photo, category: Category | null): string {
  const file = item.file;
  const parts = [
    file ? fileKindLabel(fileKindOf(file.type, file.name)) : 'File',
    ...(file?.bytes === undefined ? [] : [formatBytes(file.bytes)]),
    formatShortDay(item.takenAt),
    ...(category && (file?.category || category !== 'other') ? [categoryLabel(category)] : []),
    ...(item.library === undefined ? [] : [`Shared by ${item.library}`]),
    ...(item.sharedWith?.length ? [`Shared with ${item.sharedWith.join(', ')}`] : []),
  ];
  return parts.join(' · ');
}

/** A file as a row: its picture, name and details, and its menu. */
export function FileRow({
  item,
  details,
  menu,
  from,
  draggable,
}: {
  item: Photo;
  details: string;
  menu: MenuItem[];
  /** The album or folder it's listed in, so the viewer's back link returns there. */
  from?: PhotoContext;
  /** Whether it can be dragged onto a folder. */
  draggable?: boolean;
}) {
  const name = item.file?.name ?? 'File';
  return (
    <li className="file-row" {...dragProps(item.id, draggable)}>
      <Link to={paths.file(item.id, from)} className="file-row__main" aria-label={`Open ${name}`}>
        <FileThumb item={item} />
        <span className="file-row__text">
          <span className="file-row__name">{name}</span>
          <span className="file-row__meta">{details}</span>
        </span>
      </Link>
      <Menu
        label={`More for ${name}`}
        items={menu}
        className="file-row__menu"
        icon="more-vertical"
      />
    </li>
  );
}

/** A file as a tile: a big picture (a PDF's first page, or its icon) with its name below. */
export function FileTile({
  item,
  details,
  menu,
  from,
  draggable,
}: {
  item: Photo;
  details: string;
  menu: MenuItem[];
  from?: PhotoContext;
  draggable?: boolean;
}) {
  const name = item.file?.name ?? 'File';
  return (
    <li className="file-tile" {...dragProps(item.id, draggable)}>
      <Link to={paths.file(item.id, from)} className="file-tile__main" aria-label={`Open ${name}`}>
        <span className="file-tile__picture">
          <FileThumb item={item} size="lg" />
        </span>
        <span className="file-tile__name">{name}</span>
        <span className="file-tile__meta">{details}</span>
      </Link>
      <Menu label={`More for ${name}`} items={menu} className="file-tile__menu" icon="more" />
    </li>
  );
}
