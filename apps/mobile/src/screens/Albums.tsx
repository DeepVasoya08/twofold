import { memo, useEffect, useMemo, useState } from 'react';
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

import { albumCover, albumPhotos, albumSharing, albumsInTab } from '@arcafold/core/library/albums';
import type { AlbumTab } from '@arcafold/core/library/albums';
import type { Album, Photo } from '@arcafold/core/library/model';
import type { SmartAlbum } from '@arcafold/core/search/smart-album';

import { MemoryImage } from '../../modules/memory-image';
import { photoCount } from '../library/album-text';
import type { Library } from '../library/use-library';
import { fonts } from '../theme';
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
      <View
        style={[
          styles.cover,
          {
            width,
            height: width * 1.25,
            // An arch, as on the web: Arcafold's shape, so albums stand out at a glance.
            borderTopLeftRadius: width / 2,
            borderTopRightRadius: width / 2,
            backgroundColor: palette.surface,
          },
        ]}
      >
        {coverId ? (
          <MemoryImage imageId={imageId} style={{ width, height: width * 1.25 }} />
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

const TABS: readonly { id: AlbumTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'with-me', label: 'Shared with me' },
  { id: 'by-me', label: 'Shared by me' },
];

const EMPTY: Record<Exclude<AlbumTab, 'all'>, string> = {
  'with-me':
    'Nothing’s shared with you yet. When someone shares an album with you, it shows up here.',
  'by-me': 'You haven’t shared any albums. Open an album, then ⋯ and Share, to invite someone.',
};

/** Your albums, and those shared with you: the Albums tab. */
export function Albums({
  library,
  initial,
  banner,
  onSettings,
  onNew,
  onOpen,
  onJoin,
  onTrash,
  smartAlbums = [],
  onOpenSmart,
}: {
  library: Library;
  initial: string;
  banner: ReactNode;
  onSettings: () => void;
  onNew: () => void;
  onOpen: (albumId: string) => void;
  /** Opens the screen for entering an invite code. */
  onJoin: () => void;
  /** Opens Recently deleted. */
  onTrash: () => void;
  /** Searches saved as albums, while Smart search is on here: yours alone, never shared. */
  smartAlbums?: readonly SmartAlbum[];
  onOpenSmart?: (albumId: string) => void;
}) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const cardWidth = Math.floor((width - GUTTER * 2 - GAP) / 2);
  const [tab, setTab] = useState<AlbumTab>('all');
  const cards = useMemo(
    () => albumCards(albumsInTab(library.albums, tab), library.photos),
    [library.albums, library.photos, tab],
  );
  const { thumbs, requestThumbs } = library;

  const header = (
    <AppHeader title="Albums" initial={initial} onSettings={onSettings}>
      {library.status === 'ready' ? (
        <HeaderButton label="+ New" accessibilityLabel="New album" filled onPress={onNew} />
      ) : null}
    </AppHeader>
  );

  const tabs = (
    <View style={styles.tabs} accessibilityRole="tablist">
      {TABS.map((each) => {
        const chosen = each.id === tab;
        return (
          <Pressable
            key={each.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: chosen }}
            onPress={() => {
              setTab(each.id);
            }}
            style={[
              styles.chip,
              chosen
                ? { backgroundColor: palette.accent, borderColor: palette.accent }
                : { borderColor: palette.border },
            ]}
          >
            <Text style={[styles.chipText, { color: chosen ? palette.onAccent : palette.text }]}>
              {each.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
  const codeLink =
    tab === 'with-me' ? (
      <Pressable accessibilityRole="button" onPress={onJoin} style={styles.codeLink}>
        <Text style={[styles.meta, { color: palette.muted }]}>
          Got an invite code from someone?{' '}
          <Text style={{ color: palette.accent, fontWeight: '600' }}>Enter it here</Text>
        </Text>
      </Pressable>
    ) : null;

  // Smart albums are your own and can't be shared, so only All lists them.
  const smart = tab === 'all' && onOpenSmart ? smartAlbums : [];
  const smartList =
    smart.length > 0 && onOpenSmart ? (
      <View style={styles.smart}>
        <Text style={[styles.smartHeading, { color: palette.text }]} accessibilityRole="header">
          Smart albums
        </Text>
        {smart.map((album) => (
          <Pressable
            key={album.id}
            accessibilityRole="button"
            accessibilityLabel={`${album.title}, smart album`}
            onPress={() => {
              onOpenSmart(album.id);
            }}
            style={[styles.smartRow, { borderColor: palette.border }]}
          >
            <Text style={[styles.smartGlyph, { color: palette.accent }]}>✦</Text>
            <View style={styles.smartText}>
              <Text style={[styles.trashText, { color: palette.text }]} numberOfLines={1}>
                {album.title}
              </Text>
              <Text style={[styles.meta, { color: palette.muted }]}>
                Fills itself from a search
              </Text>
            </View>
            <Text style={[styles.meta, { color: palette.muted }]}>›</Text>
          </Pressable>
        ))}
      </View>
    ) : null;

  const trashCount = library.trash?.length ?? 0;
  const trashLink = (
    <Pressable
      accessibilityRole="button"
      onPress={onTrash}
      style={[styles.trash, { borderColor: palette.border }]}
    >
      <Text style={[styles.trashText, { color: palette.text }]}>Recently deleted</Text>
      <Text style={[styles.meta, { color: palette.muted }]}>{photoCount(trashCount)} ›</Text>
    </Pressable>
  );

  if (library.status === 'ready' && tab !== 'all' && cards.length === 0) {
    return (
      <View style={styles.fill}>
        {header}
        {banner}
        {tabs}
        {codeLink}
        <View style={styles.centre}>
          <Note>{EMPTY[tab]}</Note>
        </View>
      </View>
    );
  }

  if (library.status !== 'ready' || cards.length + smart.length === 0) {
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
              <Button kind="link" label="Enter an invite code" onPress={onJoin} />
              {trashCount > 0 ? trashLink : null}
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
      {tabs}
      {codeLink}
      <FlatList
        data={cards}
        numColumns={2}
        keyExtractor={(card) => card.album.id}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        extraData={thumbs}
        ListFooterComponent={
          tab === 'all' ? (
            <>
              {smartList}
              {trashLink}
            </>
          ) : undefined
        }
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
  emptyTitle: { fontFamily: fonts.display, fontSize: 22, letterSpacing: -0.3 },
  list: { paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 32, gap: 20 },
  row: { gap: GAP },
  cover: {
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCover: { fontSize: 32 },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: GUTTER,
    paddingBottom: 12,
  },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  chipText: { fontSize: 14, fontWeight: '600' },
  codeLink: { paddingHorizontal: GUTTER, paddingBottom: 12 },
  smart: { gap: 4, paddingBottom: 16 },
  smartHeading: { fontFamily: fonts.display, fontSize: 18, paddingBottom: 6 },
  smartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  smartGlyph: { fontSize: 20 },
  smartText: { flex: 1, gap: 2 },
  trash: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
    marginTop: 4,
  },
  trashText: { fontSize: 15, fontWeight: '600' },
  badge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  title: { fontFamily: fonts.display, fontSize: 16, letterSpacing: -0.2, marginTop: 10 },
  meta: { fontSize: 13, marginTop: 1 },
});
