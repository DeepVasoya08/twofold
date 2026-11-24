import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { photoCount } from '../library/album-text';
import { favoritePhotos, gridRows, photosInRows } from '../library/timeline';
import type { Library } from '../library/use-library';
import { FAVORITE, fonts } from '../theme';
import { Icon } from '../ui/icons';
import { Note } from '../ui/kit';
import { usePalette } from '../ui/theme';
import { PageTop } from './AppHeader';
import { PhotoGrid } from './PhotoGrid';
import { usePickToDelete } from './use-pick-to-delete';

/**
 * Every photo you gave a heart, newest first by month, as the web's Favorites page shows
 * them. Opened from its card on Albums. Taking a heart off a photo takes it off this page.
 */
export function FavoritesScreen({
  library,
  banner,
  onBack,
  onOpen,
  onShare,
  onSave,
  onTeach,
}: {
  library: Library;
  banner: ReactNode;
  onBack: () => void;
  onOpen: (photoId: string) => void;
  /** Shares picked photos with someone, through an album. */
  onShare?: (photoIds: readonly string[]) => void;
  onSave?: (photoIds: readonly string[]) => void;
  onTeach?: (photoIds: readonly string[]) => void;
}) {
  const palette = usePalette();
  const photos = useMemo(() => favoritePhotos(library.photos), [library.photos]);
  const rows = useMemo(() => gridRows(photos), [photos]);
  const all = useMemo(() => photosInRows(rows), [rows]);
  const picking = usePickToDelete(library, onOpen, {
    onShare,
    onSave,
    onTeach,
    filing: library,
    all,
  });

  const summary = (
    <View style={styles.summary}>
      <View
        style={[styles.mark, { backgroundColor: palette.dark ? '#3a2230' : '#ffe3ea' }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon name="heart" size={28} color={FAVORITE} />
      </View>
      <View style={styles.text}>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Favorites
        </Text>
        <Text style={[styles.meta, { color: palette.muted }]}>
          {photos.length > 0 ? `${photoCount(photos.length)} you keep coming back to` : ''}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.fill}>
      {picking.header ?? <PageTop onBack={onBack} />}
      {banner}
      {photos.length === 0 ? (
        <View style={styles.centre}>
          {summary}
          <Text style={[styles.emptyTitle, { color: palette.text }]}>No favorites yet</Text>
          <Note>Tap the heart on any photo to keep it here.</Note>
        </View>
      ) : (
        <PhotoGrid
          rows={rows}
          thumbs={library.thumbs}
          requestThumbs={library.requestThumbs}
          {...picking.grid}
          header={summary}
        />
      )}
      {picking.sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 22, letterSpacing: -0.3 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, paddingTop: 4 },
  mark: {
    width: 60,
    height: 76,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.display, fontSize: 30, letterSpacing: -0.8 },
  meta: { fontSize: 14 },
});
