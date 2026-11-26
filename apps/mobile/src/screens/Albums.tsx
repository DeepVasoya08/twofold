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
import { inTrashedFolder, trashedFolders } from '@arcafold/core/library/folders';
import type { Album, Photo } from '@arcafold/core/library/model';
import type { SmartAlbum } from '@arcafold/core/search/smart-album';

import { MemoryImage } from '../../modules/memory-image';
import { photoCount } from '../library/album-text';
import { filterByName } from '../library/match';
import { favoritePhotos } from '../library/timeline';
import { trashSummary } from '../library/trash-text';
import type { Library } from '../library/use-library';
import { FAVORITE, fonts } from '../theme';
import { useAppearance } from '../ui/appearance';
import { useFloatSpace, useReportPicking } from '../ui/float-space';
import { Icon } from '../ui/icons';
import { Button, Note } from '../ui/kit';
import { usePullToRefresh } from '../ui/pull-refresh';
import { usePalette } from '../ui/theme';
import type { Palette } from '../ui/theme';
import { ALBUM_CHOICES, ALBUM_COLUMNS } from '../ui/view-choices';
import { ViewSheet } from '../ui/view-sheet';
import { AppHeader } from './AppHeader';

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

/** The Favorites card, first on All: your hearted photos, newest as its cover. */
const FavoritesCard = memo(function FavoritesCard({
  coverId,
  imageId,
  count,
  width,
  palette,
  requestThumbs,
  onOpen,
}: {
  coverId: string | null;
  imageId: string | null;
  count: number;
  width: number;
  palette: Palette;
  requestThumbs: Library['requestThumbs'];
  onOpen: () => void;
}) {
  useEffect(() => {
    if (coverId && !imageId) requestThumbs([coverId], true);
  }, [coverId, imageId, requestThumbs]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Favorites, ${photoCount(count)}`}
      onPress={onOpen}
      style={{ width }}
    >
      <View
        style={[
          styles.cover,
          {
            width,
            height: width * 1.25,
            borderTopLeftRadius: width / 2,
            borderTopRightRadius: width / 2,
            backgroundColor: palette.dark ? '#3a2230' : '#ffe3ea',
          },
        ]}
      >
        {coverId ? <MemoryImage imageId={imageId} style={{ width, height: width * 1.25 }} /> : null}
        <View
          style={[
            coverId ? styles.heartBadge : null,
            coverId ? { backgroundColor: palette.surface } : null,
          ]}
        >
          <Icon name="heart" size={coverId ? 20 : 36} color={FAVORITE} />
        </View>
      </View>
      <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
        Favorites
      </Text>
      <Text style={[styles.meta, { color: palette.muted }]} numberOfLines={1}>
        {count > 0 ? photoCount(count) : 'Tap the heart on a photo'}
      </Text>
    </Pressable>
  );
});

/** What the grid lists: the Favorites card, then albums. */
type GridItem = { kind: 'favorites' } | ({ kind: 'album' } & Card);

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

/**
 * Your albums, and those shared with you: the Albums tab. The search field under the title
 * finds albums by name as you type; View shows them two or three across. New albums come from
 * the floating Add button (Home).
 */
export function Albums({
  library,
  initial,
  banner,
  onSettings,
  onNew,
  onOpen,
  onJoin,
  onTrash,
  onFavorites,
  smartAlbums = [],
  onOpenSmart,
  onPicking,
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
  /** Opens Favorites. */
  onFavorites: () => void;
  /** Searches saved as albums, while Smart search is on here: yours alone, never shared. */
  smartAlbums?: readonly SmartAlbum[];
  onOpenSmart?: (albumId: string) => void;
  /** Says when the View sheet opens and closes, so the floating buttons step aside. */
  onPicking?: (picking: boolean) => void;
}) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const { albumView, setAlbumView } = useAppearance();
  const floatSpace = useFloatSpace();
  const refreshControl = usePullToRefresh(library.refresh);
  const columns = ALBUM_COLUMNS[albumView];
  const cardWidth = Math.floor((width - GUTTER * 2 - GAP * (columns - 1)) / columns);
  const [tab, setTab] = useState<AlbumTab>('all');
  const [query, setQuery] = useState('');
  const [choosingView, setChoosingView] = useState(false);
  useReportPicking(choosingView, onPicking);
  const allCards = useMemo(
    () => albumCards(albumsInTab(library.albums, tab), library.photos),
    [library.albums, library.photos, tab],
  );
  const cards = useMemo(
    () => filterByName(allCards, query, (card) => card.album.title),
    [allCards, query],
  );
  const { thumbs, requestThumbs } = library;
  const favorites = useMemo(() => favoritePhotos(library.photos), [library.photos]);
  // Favorites leads All, and stays findable by its name.
  const showFavorites =
    tab === 'all' && filterByName(['Favorites'], query, (title) => title).length > 0;
  const items = useMemo<GridItem[]>(
    () => [
      ...(showFavorites ? [{ kind: 'favorites' as const }] : []),
      ...cards.map((card) => ({ kind: 'album' as const, ...card })),
    ],
    [showFavorites, cards],
  );
  const favoriteCover = useMemo(() => {
    let newest: Photo | null = null;
    for (const photo of favorites) if (!newest || photo.takenAt > newest.takenAt) newest = photo;
    return newest?.id ?? null;
  }, [favorites]);

  const header = (
    <AppHeader
      title="Albums"
      initial={initial}
      onSettings={onSettings}
      search={{
        placeholder: 'Search albums',
        query,
        onQuery: setQuery,
        view: {
          icon: albumView === 'large' ? 'grid' : 'compact',
          label: 'View',
          onPress: () => {
            setChoosingView(true);
          },
        },
      }}
    />
  );
  const viewSheet = choosingView ? (
    <ViewSheet
      choices={ALBUM_CHOICES}
      value={albumView}
      onPick={setAlbumView}
      onCancel={() => {
        setChoosingView(false);
      }}
    />
  ) : null;

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
                ? { backgroundColor: palette.text, borderColor: palette.text }
                : { borderColor: palette.border },
            ]}
          >
            <Text style={[styles.chipText, { color: chosen ? palette.background : palette.text }]}>
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
  const allSmart = tab === 'all' && onOpenSmart ? smartAlbums : [];
  const smart = filterByName(allSmart, query, (album) => album.title);
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

  const trashItems = useMemo(
    () => (library.trash ?? []).filter((item) => !inTrashedFolder(item, library.folders)).length,
    [library.trash, library.folders],
  );
  const trashFolders = useMemo(
    () => trashedFolders(library.folders).filter((folder) => !folder.viewOnly).length,
    [library.folders],
  );
  const trashCount = trashItems + trashFolders;
  const trashLink = (
    <Pressable
      accessibilityRole="button"
      onPress={onTrash}
      style={[styles.trash, { borderColor: palette.border }]}
    >
      <Text style={[styles.trashText, { color: palette.text }]}>Recently deleted</Text>
      <Text style={[styles.meta, { color: palette.muted }]}>
        {trashSummary(trashItems, trashFolders)} ›
      </Text>
    </Pressable>
  );

  if (library.status === 'ready' && query.trim() !== '' && items.length + smart.length === 0) {
    return (
      <View style={styles.fill}>
        {header}
        {banner}
        {tabs}
        <View style={styles.centre}>
          <Note>No albums called “{query.trim()}”.</Note>
        </View>
        {viewSheet}
      </View>
    );
  }

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
        {viewSheet}
      </View>
    );
  }

  if (
    library.status !== 'ready' ||
    allCards.length + allSmart.length + (tab === 'all' ? favorites.length : 0) === 0
  ) {
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
        key={columns}
        data={items}
        numColumns={columns}
        keyExtractor={(item) => (item.kind === 'favorites' ? 'favorites' : item.album.id)}
        columnWrapperStyle={styles.row}
        contentContainerStyle={[styles.list, { paddingBottom: 32 + floatSpace }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        extraData={thumbs}
        ListFooterComponent={
          tab === 'all' ? (
            <>
              {smartList}
              {trashLink}
            </>
          ) : undefined
        }
        renderItem={({ item }) =>
          item.kind === 'favorites' ? (
            <FavoritesCard
              coverId={favoriteCover}
              imageId={favoriteCover ? (thumbs.get(favoriteCover) ?? null) : null}
              count={favorites.length}
              width={cardWidth}
              palette={palette}
              requestThumbs={requestThumbs}
              onOpen={onFavorites}
            />
          ) : (
            <AlbumCard
              card={item}
              imageId={item.coverId ? (thumbs.get(item.coverId) ?? null) : null}
              width={cardWidth}
              palette={palette}
              requestThumbs={requestThumbs}
              onOpen={onOpen}
            />
          )
        }
      />
      {viewSheet}
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
  heartBadge: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: fonts.display, fontSize: 16, letterSpacing: -0.2, marginTop: 10 },
  meta: { fontSize: 13, marginTop: 1 },
});
