import { FlashList } from '@shopify/flash-list';
import type { ViewToken } from '@shopify/flash-list';
import { memo, useCallback, useEffect } from 'react';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { MemoryImage } from '../../modules/memory-image';
import { COLUMNS, photosInRows } from '../library/timeline';
import type { TimelineRow } from '../library/timeline';
import { usePalette } from '../ui/theme';
import type { Palette } from '../ui/theme';

const GAP = 2;

/** One preview. Asks for its own preview when it's drawn, which is when it's near the screen. */
const Tile = memo(function Tile({
  photoId,
  imageId,
  size,
  palette,
  chosen,
  requestThumbs,
  onPress,
}: {
  photoId: string;
  imageId: string | null;
  size: number;
  palette: Palette;
  /** Set while choosing photos: whether this one is chosen. */
  chosen: boolean | undefined;
  requestThumbs: (photoIds: readonly string[]) => void;
  onPress: (photoId: string) => void;
}) {
  useEffect(() => {
    if (!imageId) requestThumbs([photoId]);
  }, [photoId, imageId, requestThumbs]);
  const choosing = chosen !== undefined;
  return (
    <Pressable
      accessibilityRole={choosing ? 'checkbox' : 'imagebutton'}
      accessibilityLabel={choosing ? 'Photo' : 'Open photo'}
      accessibilityState={choosing ? { checked: chosen } : undefined}
      onPress={() => {
        onPress(photoId);
      }}
    >
      <MemoryImage
        imageId={imageId}
        style={{ width: size, height: size, backgroundColor: palette.surface }}
      />
      {choosing ? (
        <>
          {chosen ? (
            <View
              style={[StyleSheet.absoluteFill, styles.chosenFrame, { borderColor: palette.accent }]}
            />
          ) : null}
          <View
            style={[
              styles.tick,
              chosen
                ? { backgroundColor: palette.accent, borderColor: palette.accent }
                : { borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.25)' },
            ]}
          >
            {chosen ? <Text style={[styles.tickText, { color: palette.onAccent }]}>✓</Text> : null}
          </View>
        </>
      ) : null}
    </Pressable>
  );
});

const TileRow = memo(
  function TileRow(props: {
    photoIds: string[];
    imageIds: (string | null)[];
    chosen: (boolean | undefined)[];
    size: number;
    palette: Palette;
    requestThumbs: (photoIds: readonly string[]) => void;
    onPress: (photoId: string) => void;
  }) {
    return (
      <View style={[styles.tileRow, { height: props.size }]}>
        {props.photoIds.map((photoId, index) => (
          <Tile
            key={photoId}
            photoId={photoId}
            imageId={props.imageIds[index] ?? null}
            chosen={props.chosen[index]}
            size={props.size}
            palette={props.palette}
            requestThumbs={props.requestThumbs}
            onPress={props.onPress}
          />
        ))}
      </View>
    );
  },
  // A row only redraws when one of its own previews arrives or is chosen, not on every change.
  (before, after) =>
    before.size === after.size &&
    before.palette === after.palette &&
    before.onPress === after.onPress &&
    before.photoIds.length === after.photoIds.length &&
    before.photoIds.every((id, index) => id === after.photoIds[index]) &&
    before.imageIds.every((id, index) => id === after.imageIds[index]) &&
    before.chosen.every((chosen, index) => chosen === after.chosen[index]),
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

/**
 * Photos by month, four across, with previews downloaded and decrypted as they come near the
 * screen. Tapping a photo opens it, or, while choosing (`chosen` is set), ticks it.
 */
export function PhotoGrid({
  rows,
  thumbs,
  requestThumbs,
  onPress,
  chosen,
  header,
  footer,
  bottomPadding = 48,
}: {
  rows: readonly TimelineRow[];
  thumbs: ReadonlyMap<string, string>;
  requestThumbs: (photoIds: readonly string[], onScreen?: boolean) => void;
  onPress: (photoId: string) => void;
  chosen?: ReadonlySet<string>;
  header?: ReactElement;
  footer?: ReactElement;
  bottomPadding?: number;
}) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const size = Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS);

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
          chosen={item.photoIds.map((photoId) => (chosen ? chosen.has(photoId) : undefined))}
          size={size}
          palette={palette}
          requestThumbs={requestThumbs}
          onPress={onPress}
        />
      ),
    [palette, thumbs, chosen, size, requestThumbs, onPress],
  );

  return (
    <FlashList
      data={rows}
      renderItem={renderItem}
      keyExtractor={(row) => row.key}
      getItemType={(row) => row.kind}
      extraData={[thumbs, chosen]}
      onViewableItemsChanged={onViewableItemsChanged}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
    />
  );
}

const styles = StyleSheet.create({
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
  chosenFrame: { borderWidth: 3 },
  tick: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickText: { fontSize: 13, fontWeight: '800' },
});
