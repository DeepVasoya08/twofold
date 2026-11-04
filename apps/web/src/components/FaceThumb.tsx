import type { Face } from '@arcafold/core/people/grouping';
import { Icon } from './Icon';
import { PhotoImage } from './PhotoImage';
import type { Photo } from '@arcafold/core/library/model';

import './face-thumb.css';

/** How much room is left around a face, as a multiple of its larger side. */
const MARGIN = 1.6;

/**
 * Where the photo goes inside a square so one face fills it: the image's width and offsets,
 * as percentages of the square's side.
 */
export function faceCrop(
  face: Pick<Face, 'x' | 'y' | 'width' | 'height'>,
  photo: Pick<Photo, 'width' | 'height'>,
): { width: number; left: number; top: number } {
  const side = Math.max(face.width * photo.width, face.height * photo.height) * MARGIN;
  const centerX = (face.x + face.width / 2) * photo.width;
  const centerY = (face.y + face.height / 2) * photo.height;
  return {
    width: (photo.width / side) * 100,
    left: (0.5 - centerX / side) * 100,
    top: (0.5 - centerY / side) * 100,
  };
}

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
