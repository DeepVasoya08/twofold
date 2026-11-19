import { faceCrop } from '@arcafold/core/people/edits';
import type { Face } from '@arcafold/core/people/grouping';
import { Icon } from './Icon';
import { PhotoImage } from './PhotoImage';
import type { Photo } from '@arcafold/core/library/model';

import './face-thumb.css';

/** One face, cut out of its photo's preview into a circle. */
export function FaceThumb({
  face,
  photo,
  size = 'md',
}: {
  face: Face | undefined;
  photo: Photo | undefined;
  size?: 'sm' | 'md' | 'lg';
}) {
  if (!face || !photo || photo.width <= 0 || photo.height <= 0) {
    return (
      <span className={`face-thumb face-thumb--${size} face-thumb--empty`} aria-hidden="true">
        <Icon name="person" size={24} />
      </span>
    );
  }
  const crop = faceCrop(face, photo);
  return (
    <span className={`face-thumb face-thumb--${size}`} aria-hidden="true">
      <PhotoImage
        className="face-thumb__image"
        photoId={photo.id}
        src={photo.src}
        alt=""
        style={{
          width: `${String(crop.width)}%`,
          left: `${String(crop.left)}%`,
          top: `${String(crop.top)}%`,
        }}
      />
    </span>
  );
}
