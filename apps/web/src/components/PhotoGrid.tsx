import { memo } from 'react';

import { Link } from '../app/router';
import { paths } from '../app/routes';
import type { PhotoContext } from '../app/routes';
import type { Selection } from '../app/selection';
import { formatShortDay } from '../lib/format';
import type { Photo } from '../mock/data';
import { FileIcon } from './FileIcon';
import { Icon } from './Icon';
import { PhotoImage } from './PhotoImage';

import './photo-grid.css';

interface PhotoGridProps {
  photos: readonly Photo[];
  context: PhotoContext;
  /** Lets photos be picked; while picking, a tap selects instead of opening. */
  selection?: Pick<Selection, 'selected' | 'selecting' | 'toggle'> | undefined;
  /** A short line over each tile, such as how long a deleted photo has left. */
  note?: ((photo: Photo) => string) | undefined;
}

export function PhotoGrid({ photos, context, selection, note }: PhotoGridProps) {
  const selecting = selection?.selecting ?? false;
  return (
    <ul className={`photo-grid${selecting ? ' is-selecting' : ''}`}>
      {photos.map((photo) => (
        <PhotoTile
          key={photo.id}
          photo={photo}
          href={
            photo.file
              ? photo.deletedAt
                ? paths.trash
                : paths.files
              : paths.photo(photo.id, context)
          }
          selected={selection?.selected.has(photo.id) ?? false}
          selecting={selecting}
          toggle={selection?.toggle}
          note={note?.(photo)}
        />
      ))}
    </ul>
  );
}

interface PhotoTileProps {
  photo: Photo;
  href: string;
  selected: boolean;
  selecting: boolean;
  toggle: ((photoId: string) => void) | undefined;
  note?: string | undefined;
}

/**
 * One tile. Memoized: a preview arriving changes only its own photo, so the rest of the grid
 * (hundreds of tiles in a big library) doesn't render again each time.
 */
const PhotoTile = memo(function PhotoTile({
  photo,
  href,
  selected,
  selecting,
  toggle,
  note,
}: PhotoTileProps) {
  const shared = photo.library === undefined ? '' : `, shared by ${photo.library}`;
  const label = photo.file
    ? `File ${photo.file.name}${shared}`
    : `Photo from ${formatShortDay(photo.takenAt)}${photo.location ? `, ${photo.location}` : ''}${shared}`;
  return (
    <li className={`photo-grid__item${selected ? ' is-selected' : ''}`}>
      <Link
        to={href}
        className="photo-tile"
        aria-label={label}
        onClick={(event) => {
          if (!toggle || !selecting) return;
          event.preventDefault();
          toggle(photo.id);
        }}
      >
        {photo.file ? (
          // A file shows its icon; its stored preview is a stand-in, never fetched.
          <FileIcon file={photo.file} size="lg" />
        ) : (
          <PhotoImage
            photoId={photo.id}
            src={photo.src}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        )}
        {photo.library !== undefined && (
          <span className="photo-tile__shared" aria-hidden="true" data-testid="shared-badge">
            <Icon name="users" size={12} />
            <span className="photo-tile__shared-name">{photo.library}</span>
          </span>
        )}
        {note && <span className="photo-tile__note">{note}</span>}
        {photo.favorite && !note && (
          <span className="photo-tile__fav" aria-hidden="true">
            <Icon name="heart" size={14} filled />
          </span>
        )}
      </Link>
      {toggle && (
        <button
          type="button"
          className="photo-tile__check"
          aria-label={`Select ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
          aria-pressed={selected}
          onClick={() => {
            toggle(photo.id);
          }}
        >
          <Icon name="check" size={16} />
        </button>
      )}
    </li>
  );
});
