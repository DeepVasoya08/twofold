import { Link } from '../app/router';
import { paths } from '../app/routes';
import type { PhotoContext } from '../app/routes';
import type { Selection } from '../app/selection';
import { formatShortDay } from '../lib/format';
import type { Photo } from '../mock/data';
import { Icon } from './Icon';
import { PhotoImage } from './PhotoImage';

import './photo-grid.css';

interface PhotoGridProps {
  photos: readonly Photo[];
  context: PhotoContext;
  /** Lets photos be picked; while picking, a tap selects instead of opening. */
  selection?: Pick<Selection, 'selected' | 'selecting' | 'toggle'> | undefined;
}

export function PhotoGrid({ photos, context, selection }: PhotoGridProps) {
  const selecting = selection?.selecting ?? false;
  return (
    <ul className={`photo-grid${selecting ? ' is-selecting' : ''}`}>
      {photos.map((photo) => {
        const label = `Photo from ${formatShortDay(photo.takenAt)}${photo.location ? `, ${photo.location}` : ''}`;
        const selected = selection?.selected.has(photo.id) ?? false;
        return (
          <li key={photo.id} className={`photo-grid__item${selected ? ' is-selected' : ''}`}>
            <Link
              to={paths.photo(photo.id, context)}
              className="photo-tile"
              aria-label={label}
              onClick={(event) => {
                if (!selection || !selecting) return;
                event.preventDefault();
                selection.toggle(photo.id);
              }}
            >
              <PhotoImage
                photoId={photo.id}
                src={photo.src}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
              />
              {photo.favorite && (
                <span className="photo-tile__fav" aria-hidden="true">
                  <Icon name="heart" size={14} filled />
                </span>
              )}
            </Link>
            {selection && (
              <button
                type="button"
                className="photo-tile__check"
                aria-label={`Select ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
                aria-pressed={selected}
                onClick={() => {
                  selection.toggle(photo.id);
                }}
              >
                <Icon name="check" size={16} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
