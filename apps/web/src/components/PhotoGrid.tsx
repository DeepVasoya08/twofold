import { Link } from '../app/router';
import { paths } from '../app/routes';
import type { PhotoContext } from '../app/routes';
import { formatShortDay } from '../lib/format';
import type { Photo } from '../mock/data';
import { Icon } from './Icon';

import './photo-grid.css';

interface PhotoGridProps {
  photos: readonly Photo[];
  context: PhotoContext;
}

export function PhotoGrid({ photos, context }: PhotoGridProps) {
  return (
    <ul className="photo-grid">
      {photos.map((photo) => (
        <li key={photo.id} className="photo-grid__item">
          <Link
            to={paths.photo(photo.id, context)}
            className="photo-tile"
            aria-label={`Photo from ${formatShortDay(photo.takenAt)}${photo.location ? `, ${photo.location}` : ''}`}
          >
            <img src={photo.src} alt="" loading="lazy" decoding="async" draggable={false} />
            {photo.favorite && (
              <span className="photo-tile__fav" aria-hidden="true">
                <Icon name="heart" size={14} filled />
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
