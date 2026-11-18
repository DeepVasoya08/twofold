import { memo, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { albumCover, albumPhotos, albumSharing } from '@arcafold/core/library/albums';
import type { Album, Photo } from '@arcafold/core/library/model';

import { MemoryImage } from '../../modules/memory-image';
import { photoCount } from '../library/album-text';
import type { Library } from '../library/use-library';
import { Button, Note } from '../ui/kit';
import { usePalette } from '../ui/theme';
import type { Palette } from '../ui/theme';
import { AppHeader, HeaderButton } from './AppHeader';

const GUTTER = 16;
const GAP = 12;

interface Card {
  album: Album;
  coverId: string | null;
  count: number;
  sharing: string | null;
}

/** An album's card: its cover, name, how many photos, and who it's shared with or by. */
const AlbumCard = memo(function AlbumCard({
  card,
  imageId,
  width,
  palette,
  requestThumbs,
  onOpen,
}: {
  card: Card;
  imageId: string | null;
  width: number;
  palette: Palette;
  requestThumbs: Library['requestThumbs'];
  onOpen: (albumId: string) => void;
}) {
  const { album, coverId } = card;
  useEffect(() => {
    if (coverId && !imageId) requestThumbs([coverId], true);
  }, [coverId, imageId, requestThumbs]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${album.title}, ${photoCount(card.count)}`}
      onPress={() => {
        onOpen(album.id);
      }}
      style={{ width }}
    >
      <View style={[styles.cover, { width, height: width, backgroundColor: palette.surface }]}>
        {coverId ? (
          <MemoryImage imageId={imageId} style={{ width, height: width }} />
        ) : (
          <Text style={[styles.emptyCover, { color: palette.muted }]}>＋</Text>
        )}
        {album.library !== undefined ? (
          <View style={[styles.badge, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
            <Text style={styles.badgeText}>Shared with you</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
        {album.title}
      </Text>
      <Text style={[styles.meta, { color: palette.muted }]} numberOfLines={1}>
        {photoCount(card.count)}
      </Text>
      {card.sharing ? (
        <Text style={[styles.meta, { color: palette.muted }]} numberOfLines={1}>
          {card.sharing}
        </Text>
      ) : null}
    </Pressable>
  );
});

/** Cards for every album, in the order they were made. */
export function albumCards(albums: readonly Album[], photos: readonly Photo[]): Card[] {
  return albums.map((album) => ({
    album,
    coverId: albumCover(photos, album)?.id ?? null,
    count: albumPhotos(photos, album.id).length,
    sharing: albumSharing(album),
  }));
}

/** Your albums, and those shared with you: the Albums tab. */
export function Albums({
  library,
  initial,
  banner,
  onSettings,
  onNew,
  onOpen,
}: {
  library: Library;
  initial: string;
  banner: ReactNode;
  onSettings: () => void;
  onNew: () => void;
  onOpen: (albumId: string) => void;
}) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const cardWidth = Math.floor((width - GUTTER * 2 - GAP) / 2);
  const cards = useMemo(
    () => albumCards(library.albums, library.photos),
    [library.albums, library.photos],
  );
  const { thumbs, requestThumbs } = library;

  const header = (
    <AppHeader title="Albums" initial={initial} onSettings={onSettings}>
      {library.status === 'ready' ? (
        <HeaderButton label="+ New" accessibilityLabel="New album" filled onPress={onNew} />
      ) : null}
    </AppHeader>
  );

  if (library.status !== 'ready' || cards.length === 0) {
    return (
      <View style={styles.fill}>
        {header}
        {banner}
        <View style={styles.centre}>
          {library.status === 'loading' ? (
            <ActivityIndicator color={palette.accent} size="large" />
          ) : library.status === 'failed' ? (
            <>
              <Note>Your albums couldn’t be loaded. Check your connection and try again.</Note>
              <Button label="Try again" onPress={library.retry} />
            </>
          ) : (
            <>
              <Text style={[styles.emptyTitle, { color: palette.text }]}>No albums yet</Text>
              <Note>Gather photos into albums: a trip, a year, the people you love.</Note>
              <Button label="New album" onPress={onNew} />
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      {header}
      {banner}
      <FlatList
        data={cards}
        numColumns={2}
        keyExtractor={(card) => card.album.id}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        extraData={thumbs}
        renderItem={({ item }) => (
          <AlbumCard
            card={item}
            imageId={item.coverId ? (thumbs.get(item.coverId) ?? null) : null}
            width={cardWidth}
            palette={palette}
            requestThumbs={requestThumbs}
            onOpen={onOpen}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700' },
  list: { paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 32, gap: 20 },
  row: { gap: GAP },
  cover: {
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCover: { fontSize: 32 },
  badge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  title: { fontSize: 15, fontWeight: '600', marginTop: 8 },
  meta: { fontSize: 13, marginTop: 1 },
});
