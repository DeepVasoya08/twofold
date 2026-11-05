import { FlashList } from '@shopify/flash-list';
import type { ViewToken } from '@shopify/flash-list';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  PermissionsAndroid,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import type { Session } from '@arcafold/core/account';
import { summarizeUploads } from '@arcafold/core/upload/progress';

import logo from '../../assets/logo.png';
import { MemoryImage, PhotoPicker } from '../../modules/memory-image';
import { photosInRows, timelineOrder, timelineRows, COLUMNS } from '../library/timeline';
import type { TimelineRow } from '../library/timeline';
import { firstFailure, uploadHeadline } from '../library/upload-text';
import { useLibrary } from '../library/use-library';
import type { Library } from '../library/use-library';
import { useAccount } from '../session/account';
import { Banner, Button, Note } from '../ui/kit';
import { Viewer } from './Viewer';
import { usePalette } from '../ui/theme';
import type { Palette } from '../ui/theme';

const GAP = 2;

/**
 * Asks (from Android 13, where it's needed) to post the notification that says when photos
 * finished uploading in the background. Saying no only means no notification.
 */
async function askToNotify(): Promise<void> {
  if (Platform.OS !== 'android' || Platform.Version < 33) return;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(permission)) return;
  await PermissionsAndroid.request(permission).catch(() => undefined);
}

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

/** How the photos being added are getting on, over the bottom of the timeline. */
function UploadCard({ library, palette }: { library: Library; palette: Palette }) {
  const { items } = library.uploads;
  const summary = useMemo(() => summarizeUploads(items.map((item) => item.status)), [items]);
  if (items.length === 0) return null;
  const failure = firstFailure(items);
  return (
    <View
      style={[styles.uploadCard, { backgroundColor: palette.surface, borderColor: palette.border }]}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.uploadTop}>
        <Text style={[styles.uploadTitle, { color: palette.text }]}>{uploadHeadline(summary)}</Text>
        {summary.running > 0 ? (
          <ActivityIndicator color={palette.accent} />
        ) : (
          <Button kind="link" label="Done" onPress={library.hideUploads} />
        )}
      </View>
      <View style={[styles.uploadTrack, { backgroundColor: palette.track }]}>
        <View
          style={[
            styles.uploadBar,
            {
              width: `${String(summary.percent)}%`,
              backgroundColor: summary.failed > 0 ? palette.warning : palette.accent,
            },
          ]}
        />
      </View>
      {summary.running > 0 ? (
        <Text style={[styles.uploadNote, { color: palette.muted }]}>
          You can leave Arcafold: they keep going, and a notification says when they’re in.
        </Text>
      ) : null}
      {failure ? (
        <Text style={[styles.uploadNote, { color: palette.error }]}>{failure}</Text>
      ) : null}
    </View>
  );
}

/** The open space's photos, newest first, by month. */
export function Timeline({ session }: { session: Session }) {
  const { space, lock, logOut, onSystemScreen } = useAccount();
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
  const [pickError, setPickError] = useState<string | null>(null);
  const { addPhotos } = library;
  const pickPhotos = useCallback(() => {
    setPickError(null);
    onSystemScreen(() => PhotoPicker.pickAsync()).then(
      (picked) => {
        addPhotos(picked);
        if (picked.length > 0) void askToNotify();
      },
      () => {
        setPickError('The photo picker couldn’t open. Try again.');
      },
    );
  }, [onSystemScreen, addPhotos]);

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
      {library.status === 'ready' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add photos"
          onPress={pickPhotos}
          style={[styles.headerButton, styles.addButton, { backgroundColor: palette.accent }]}
        >
          <Text style={[styles.headerButtonText, { color: palette.onAccent }]}>+ Add</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={lock}
        style={[styles.headerButton, { borderColor: palette.border }]}
      >
        <Text style={[styles.headerButtonText, { color: palette.text }]}>Lock</Text>
      </Pressable>
    </View>
  );
  const banner = pickError ? (
    <View style={styles.bannerWrap}>
      <Banner>{pickError}</Banner>
    </View>
  ) : null;

  if (library.status !== 'ready' || rows.length === 0) {
    return (
      <View style={[styles.fill, { backgroundColor: palette.background }]}>
        {header}
        {banner}
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
                Add photos from this phone, or at arcafold.com. They’re encrypted before they leave
                the device.
              </Note>
              <Button label="Add photos" onPress={pickPhotos} />
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
        <UploadCard library={library} palette={palette} />
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: palette.background }]}>
      {header}
      {banner}
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
      <UploadCard library={library} palette={palette} />
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
  addButton: { borderWidth: 0 },
  bannerWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  uploadCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 24,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
    elevation: 6,
  },
  uploadTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  uploadTitle: { flex: 1, fontSize: 15, fontWeight: '600' },
  uploadTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  uploadBar: { height: 6, borderRadius: 3 },
  uploadNote: { fontSize: 13 },
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
