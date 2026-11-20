import { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { faceCrop } from '@arcafold/core/people/edits';
import type { Face } from '@arcafold/core/people/grouping';
import type { Photo } from '@arcafold/core/library/model';

import { MemoryImage } from '../../modules/memory-image';
import { usePalette } from '../ui/theme';

/**
 * One face, cut out of its photo's preview into a circle `size` across. The whole preview is
 * drawn larger than the circle, moved so the face sits in the middle, and the rest is clipped.
 */
export const FaceThumb = memo(function FaceThumb({
  face,
  photo,
  imageId,
  size,
  requestThumbs,
}: {
  face: Face | undefined;
  photo: Pick<Photo, 'id' | 'width' | 'height'> | undefined;
  imageId: string | null;
  size: number;
  requestThumbs: (photoIds: readonly string[], onScreen?: boolean) => void;
}) {
  const palette = usePalette();
  const photoId = photo?.id;
  useEffect(() => {
    if (photoId && !imageId) requestThumbs([photoId], true);
  }, [photoId, imageId, requestThumbs]);
  const circle = [
    styles.circle,
    { width: size, height: size, borderRadius: size / 2, backgroundColor: palette.surface },
  ];
  if (!face || !photo || photo.width <= 0 || photo.height <= 0) {
    return (
      <View style={[circle, styles.empty]} accessibilityElementsHidden>
        <Text style={{ color: palette.muted, fontSize: size / 2.5 }}>👤</Text>
      </View>
    );
  }
  const crop = faceCrop(face, photo);
  const width = (size * crop.width) / 100;
  return (
    <View
      style={circle}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <MemoryImage
        imageId={imageId}
        fit="cover"
        style={{
          position: 'absolute',
          width,
          height: (width * photo.height) / photo.width,
          left: (size * crop.left) / 100,
          top: (size * crop.top) / 100,
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  circle: { overflow: 'hidden' },
  empty: { alignItems: 'center', justifyContent: 'center' },
});
