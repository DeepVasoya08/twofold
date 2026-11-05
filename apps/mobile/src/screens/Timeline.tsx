import { FlashList } from '@shopify/flash-list';
import type { ViewToken } from '@shopify/flash-list';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import type { Session } from '@arcafold/core/account';

import logo from '../../assets/logo.png';
import { MemoryImage } from '../../modules/memory-image';
import { photosInRows, timelineOrder, timelineRows, COLUMNS } from '../library/timeline';
import type { TimelineRow } from '../library/timeline';
import { useLibrary } from '../library/use-library';
import { useAccount } from '../session/account';
import { Button, Note } from '../ui/kit';
import { Viewer } from './Viewer';
import { usePalette } from '../ui/theme';
import type { Palette } from '../ui/theme';

const GAP = 2;

/** One preview. Asks for its own preview when it's drawn, which is when it's near the screen. */
const Tile = memo(function Tile({
  photoId,
  imageId,
  size,
  placeholder,
  requestThumbs,
  onOpen,
}: {
  photoId: string;
  imageId: string | null;
  size: number;
  placeholder: string;
  requestThumbs: (photoIds: readonly string[]) => void;
  onOpen: (photoId: string) => void;
}) {
  useEffect(() => {
    if (!imageId) requestThumbs([photoId]);
  }, [photoId, imageId, requestThumbs]);
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel="Open photo"
      onPress={() => {
        onOpen(photoId);
      }}
    >
      <MemoryImage
        imageId={imageId}
        style={{ width: size, height: size, backgroundColor: placeholder }}
      />
    </Pressable>
  );
});

const TileRow = memo(
  function TileRow(props: {
    photoIds: string[];
    imageIds: (string | null)[];
    size: number;
    placeholder: string;
    requestThumbs: (photoIds: readonly string[]) => void;
    onOpen: (photoId: string) => void;
  }) {
    return (
      <View style={[styles.tileRow, { height: props.size }]}>
        {props.photoIds.map((photoId, index) => (
          <Tile
            key={photoId}
            photoId={photoId}
            imageId={props.imageIds[index] ?? null}
            size={props.size}
            placeholder={props.placeholder}
            requestThumbs={props.requestThumbs}
            onOpen={props.onOpen}
          />
        ))}
      </View>
    );
  },
  // A row only redraws when one of its own previews arrives, not on every other change.
  (before, after) =>
    before.size === after.size &&
    before.placeholder === after.placeholder &&
    before.onOpen === after.onOpen &&
    before.photoIds.length === after.photoIds.length &&
    before.photoIds.every((id, index) => id === after.photoIds[index]) &&
    before.imageIds.every((id, index) => id === after.imageIds[index]),
);

function MonthHeading({
  row,
  palette,
}: {
  row: Extract<TimelineRow, { kind: 'month' }>;
  palette: Palette;
}) {
  return (
    <View style={styles.month}>
      <Text style={[styles.monthLabel, { color: palette.text }]} accessibilityRole="header">
        {row.label}
      </Text>
      <Text style={[styles.monthCount, { color: palette.muted }]}>
        {row.count === 1 ? '1 photo' : `${String(row.count)} photos`}
      </Text>
    </View>
  );
}

/** The open space's photos, newest first, by month. */
export function Timeline({ session }: { session: Session }) {
  const { space, lock, logOut } = useAccount();
  const palette = usePalette();
  const library = useLibrary(session);
  const { thumbs, requestThumbs } = library;
  const { width } = useWindowDimensions();
  const size = Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS);
  const rows = useMemo(() => timelineRows(library.photos), [library.photos]);
  const ordered = useMemo(() => timelineOrder(library.photos, rows), [library.photos, rows]);
  const [open, setOpen] = useState<number | null>(null);
  const openPhoto = useCallback(
    (photoId: string) => {
      const at = ordered.findIndex((photo) => photo.id === photoId);
      if (at >= 0) setOpen(at);
    },
    [ordered],
  );
  const closeViewer = useCallback(() => {
    setOpen(null);
  }, []);

  // Previews actually on screen jump the queue ahead of those just drawn off screen.
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<TimelineRow>[] }) => {
      const onScreen = photosInRows(viewableItems.map((token) => token.item));
      if (onScreen.length > 0) requestThumbs(onScreen, true);
    },
    [requestThumbs],
  );

  const renderItem = useCallback(
    ({ item }: { item: TimelineRow }) =>
      item.kind === 'month' ? (
        <MonthHeading row={item} palette={palette} />
      ) : (
        <TileRow
          photoIds={item.photoIds}
          imageIds={item.photoIds.map((photoId) => thumbs.get(photoId) ?? null)}
          size={size}
          placeholder={palette.surface}
          requestThumbs={requestThumbs}
          onOpen={openPhoto}
        />
      ),
    [palette, thumbs, size, requestThumbs, openPhoto],
  );

  const title = space === 'private' ? 'Private space' : 'Library';
  const header = (
    <View style={[styles.header, { paddingTop: (StatusBar.currentHeight ?? 24) + 12 }]}>
      <Image source={logo} style={styles.headerLogo} accessible={false} />
      <Text style={[styles.headerTitle, { color: palette.text }]} accessibilityRole="header">
        {title}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={lock}
        style={[styles.headerButton, { borderColor: palette.border }]}
      >
        <Text style={[styles.headerButtonText, { color: palette.text }]}>Lock</Text>
      </Pressable>
    </View>
  );

  if (library.status !== 'ready' || rows.length === 0) {
    return (
      <View style={[styles.fill, { backgroundColor: palette.background }]}>
        {header}
        <View style={styles.centre}>
          {library.status === 'loading' ? (
            <>
              <ActivityIndicator color={palette.accent} size="large" />
              <Note>Opening your photos…</Note>
            </>
          ) : library.status === 'failed' ? (
            <>
              <Note>Your photos couldn’t be loaded. Check your connection and try again.</Note>
              <Button label="Try again" onPress={library.retry} />
            </>
          ) : (
            <>
              <Text style={[styles.emptyTitle, { color: palette.text }]}>No photos yet</Text>
              <Note>
                Photos you add at arcafold.com show here. Adding them from this phone comes in a
                later build.
              </Note>
            </>
          )}
          <Button
            kind="link"
            label="Sign out"
            onPress={() => {
              void logOut();
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: palette.background }]}>
      {header}
      <FlashList
        data={rows}
        renderItem={renderItem}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        extraData={thumbs}
        onViewableItemsChanged={onViewableItemsChanged}
        contentContainerStyle={styles.list}
        ListFooterComponent={
          <Button
            kind="link"
            label="Sign out"
            onPress={() => {
              void logOut();
            }}
          />
        }
      />
      {open !== null ? (
        <Viewer photos={ordered} start={open} library={library} onClose={closeViewer} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerLogo: { width: 28, height: 28 },
  headerTitle: { flex: 1, fontSize: 22, fontWeight: '700' },
  headerButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  headerButtonText: { fontSize: 14, fontWeight: '600' },
  centre: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700' },
  list: { paddingBottom: 48 },
  month: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 10,
  },
  monthLabel: { fontSize: 17, fontWeight: '700' },
  monthCount: { fontSize: 13 },
  tileRow: { flexDirection: 'row', gap: GAP, marginBottom: GAP },
});
