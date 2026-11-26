import { FlashList } from '@shopify/flash-list';
import type { ViewToken } from '@shopify/flash-list';
import { memo, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { RefreshControlProps } from 'react-native';

import { MemoryImage } from '../../modules/memory-image';
import { layOut } from '../library/layout';
import type { LaidOutRow } from '../library/layout';
import { photosInRows } from '../library/timeline';
import type { TimelineRow } from '../library/timeline';
import { fonts } from '../theme';
import { PhotoAspects, useAppearance } from '../ui/appearance';
import { useFloatSpace } from '../ui/float-space';
import { Icon } from '../ui/icons';
import { usePalette } from '../ui/theme';
import type { Palette } from '../ui/theme';

const GAP = 2;
/** How far a chosen photo shrinks in from its tile's edges. */
const INSET = 7;

/** One preview. Asks for its own preview when it's drawn, which is when it's near the screen. */
const Tile = memo(function Tile({
  photoId,
  imageId,
  width,
  height,
  palette,
  chosen,
  requestThumbs,
  onPress,
  onLongPress,
}: {
  photoId: string;
  imageId: string | null;
  width: number;
  height: number;
  palette: Palette;
  /** Set while choosing photos: whether this one is chosen. */
  chosen: boolean | undefined;
  requestThumbs: (photoIds: readonly string[]) => void;
  onPress: (photoId: string) => void;
  onLongPress: ((photoId: string) => void) | undefined;
}) {
  useEffect(() => {
    if (!imageId) requestThumbs([photoId]);
  }, [photoId, imageId, requestThumbs]);
  const reveal = useReveal(photoId, imageId);
  const choosing = chosen !== undefined;
  return (
    <Pressable
      accessibilityRole={choosing ? 'checkbox' : 'imagebutton'}
      accessibilityLabel={choosing ? 'Photo' : 'Open photo'}
      accessibilityState={choosing ? { checked: chosen } : undefined}
      onPress={() => {
        onPress(photoId);
      }}
      onLongPress={
        onLongPress
          ? () => {
              onLongPress(photoId);
            }
          : undefined
      }
    >
      <View
        style={{
          width,
          height,
          backgroundColor: chosen ? palette.accentWash : palette.track,
        }}
      >
        <View
          style={
            chosen
              ? [styles.shrunk, { width: width - 2 * INSET, height: height - 2 * INSET }]
              : null
          }
        >
          {imageId ? null : <Placeholder palette={palette} />}
          <MemoryImage
            imageId={imageId}
            reveal={reveal}
            style={
              chosen ? { width: width - 2 * INSET, height: height - 2 * INSET } : { width, height }
            }
          />
        </View>
      </View>
      {choosing ? (
        <View
          style={[
            styles.tick,
            chosen
              ? { backgroundColor: palette.accent, borderColor: '#ffffff' }
              : { borderColor: '#ffffff', backgroundColor: 'rgba(0,0,0,0.25)' },
          ]}
        >
          {chosen ? <Icon name="check" size={13} color="#ffffff" /> : null}
        </View>
      ) : null}
    </Pressable>
  );
});

/**
 * Whether this tile's preview should come into focus when it arrives (MemoryImage `reveal`):
 * only when it arrives while on screen. A tile reused for another photo, or one whose preview
 * was already there, shows at once.
 */
function useReveal(photoId: string, imageId: string | null): boolean {
  const [seen, setSeen] = useState({ photoId, waited: imageId === null });
  if (seen.photoId !== photoId) {
    const next = { photoId, waited: imageId === null };
    setSeen(next);
    return next.waited;
  }
  return seen.waited;
}

/**
 * While previews load, every waiting tile breathes together, so the grid reads as loading
 * rather than empty. One shared animation, running only while some tile is waiting.
 */
const pulse = new Animated.Value(0);
let waiting = 0;
let pulsing: Animated.CompositeAnimation | null = null;

function startWaiting(): void {
  waiting += 1;
  if (pulsing) return;
  pulsing = Animated.loop(
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 750, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 750, useNativeDriver: true }),
    ]),
  );
  pulsing.start();
}

function stopWaiting(): void {
  waiting = Math.max(0, waiting - 1);
  if (waiting > 0 || !pulsing) return;
  pulsing.stop();
  pulsing = null;
  pulse.setValue(0);
}

function Placeholder({ palette }: { palette: Palette }) {
  useEffect(() => {
    startWaiting();
    return stopWaiting;
  }, []);
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: palette.muted,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 0.16] }),
        },
      ]}
    />
  );
}

const TileRow = memo(
  function TileRow(props: {
    photoIds: string[];
    imageIds: (string | null)[];
    chosen: (boolean | undefined)[];
    widths: number[];
    height: number;
    gap: number;
    palette: Palette;
    requestThumbs: (photoIds: readonly string[]) => void;
    onPress: (photoId: string) => void;
    onLongPress: ((photoId: string) => void) | undefined;
  }) {
    return (
      <View
        style={[styles.tileRow, { height: props.height, gap: props.gap, marginBottom: props.gap }]}
      >
        {props.photoIds.map((photoId, index) => (
          <Tile
            key={photoId}
            photoId={photoId}
            imageId={props.imageIds[index] ?? null}
            chosen={props.chosen[index]}
            width={props.widths[index] ?? props.height}
            height={props.height}
            palette={props.palette}
            requestThumbs={props.requestThumbs}
            onPress={props.onPress}
            onLongPress={props.onLongPress}
          />
        ))}
      </View>
    );
  },
  // A row only redraws when one of its own previews arrives or is chosen, not on every change.
  (before, after) =>
    before.height === after.height &&
    before.gap === after.gap &&
    before.widths.every((each, index) => each === after.widths[index]) &&
    before.palette === after.palette &&
    before.onPress === after.onPress &&
    before.onLongPress === after.onLongPress &&
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
 * Photos by month, laid out as chosen with the View button (Grid, Compact or Uncropped), with
 * previews downloaded and decrypted as they come near the screen. Tapping a photo opens it,
 * or, while choosing (`chosen` is set), ticks it; a long press (`onLongPress`) starts
 * selecting.
 */
export function PhotoGrid({
  rows,
  thumbs,
  requestThumbs,
  onPress,
  onLongPress,
  chosen,
  header,
  footer,
  bottomPadding = 48,
  floatSpace: floatOverride,
  gap = GAP,
  refreshControl,
}: {
  rows: readonly TimelineRow[];
  thumbs: ReadonlyMap<string, string>;
  requestThumbs: (photoIds: readonly string[], onScreen?: boolean) => void;
  onPress: (photoId: string) => void;
  onLongPress?: (photoId: string) => void;
  chosen?: ReadonlySet<string>;
  header?: ReactElement;
  footer?: ReactElement;
  bottomPadding?: number;
  /** Room for what floats over the grid, when it isn't the tab bar's (a selection's bar). */
  floatSpace?: number;
  /** Space between photos; search results breathe a little more than the timeline. */
  gap?: number;
  /** Pull to refresh, where the screen offers it. */
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const { photoView } = useAppearance();
  const tabSpace = useFloatSpace();
  const floatSpace = floatOverride ?? tabSpace;
  const aspect = useContext(PhotoAspects);
  const laid = useMemo(
    () => layOut(rows, photoView, width, gap, aspect),
    [rows, photoView, width, gap, aspect],
  );

  // Previews actually on screen jump the queue ahead of those just drawn off screen.
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<LaidOutRow>[] }) => {
      const onScreen = photosInRows(viewableItems.map((token) => token.item));
      if (onScreen.length > 0) requestThumbs(onScreen, true);
    },
    [requestThumbs],
  );

  const renderItem = useCallback(
    ({ item }: { item: LaidOutRow }) =>
      item.kind === 'month' ? (
        <MonthHeading row={item} palette={palette} />
      ) : (
        <TileRow
          photoIds={item.photoIds}
          imageIds={item.photoIds.map((photoId) => thumbs.get(photoId) ?? null)}
          chosen={item.photoIds.map((photoId) => (chosen ? chosen.has(photoId) : undefined))}
          widths={item.widths}
          height={item.height}
          gap={gap}
          palette={palette}
          requestThumbs={requestThumbs}
          onPress={onPress}
          onLongPress={onLongPress}
        />
      ),
    [palette, thumbs, chosen, gap, requestThumbs, onPress, onLongPress],
  );

  return (
    <FlashList
      data={laid}
      renderItem={renderItem}
      keyExtractor={(row) => row.key}
      getItemType={(row) => row.kind}
      extraData={[thumbs, chosen]}
      onViewableItemsChanged={onViewableItemsChanged}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      {...(refreshControl && { refreshControl })}
      contentContainerStyle={{ paddingBottom: bottomPadding + floatSpace }}
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
  monthLabel: { fontFamily: fonts.display, fontSize: 18, letterSpacing: -0.3 },
  monthCount: { fontSize: 13 },
  tileRow: { flexDirection: 'row' },
  shrunk: { margin: INSET, borderRadius: 10, overflow: 'hidden' },
  tick: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
