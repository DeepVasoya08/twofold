import { useState } from 'react';

import { Link } from '../app/router';
import { paths } from '../app/routes';
import type { Folder } from '@arcafold/core/library/model';
import { pluralize } from '../lib/format';
import { dropProps, folderDragProps } from './folder-drag';
import type { Dropped } from './folder-drag';
import { Menu } from './Menu';
import type { MenuItem } from './Menu';

import './folders.css';

/** "3 files · 1 folder", or "Empty". */
export function folderSummary(counts: { folders: number; items: number }): string {
  const parts = [
    ...(counts.items > 0 ? [pluralize(counts.items, 'file')] : []),
    ...(counts.folders > 0 ? [pluralize(counts.folders, 'folder')] : []),
  ];
  return parts.length > 0 ? parts.join(' · ') : 'Empty';
}

/**
 * A folder in Files: an arch-topped card that opens it. Files and folders can be dropped on
 * it when `onDrop` is given.
 */
export function FolderTile({
  folder,
  summary,
  menu,
  onDrop,
}: {
  folder: Folder;
  summary: string;
  menu: MenuItem[];
  onDrop?: ((what: Dropped) => void) | undefined;
}) {
  const [over, setOver] = useState(false);
  return (
    <li
      className={`folder-tile${over ? ' folder-tile--over' : ''}`}
      {...(onDrop && dropProps(onDrop, setOver))}
      {...folderDragProps(folder.id, onDrop !== undefined)}
    >
      <Link
        to={paths.folder(folder.id)}
        className="folder-tile__main"
        aria-label={`Open folder ${folder.name}`}
      >
        <span className="folder-tile__icon" aria-hidden="true" />
        <span className="folder-tile__name">{folder.name}</span>
        <span className="folder-tile__meta">
          {summary}
          {folder.library !== undefined && ` · ${folder.library}’s`}
        </span>
      </Link>
      {menu.length > 0 && (
        <Menu label={`More for ${folder.name}`} items={menu} className="folder-tile__menu" />
      )}
    </li>
  );
}
