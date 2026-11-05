import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useEffect, useState } from 'react';
import {
  BackHandler,
  FlatList,
  PixelRatio,
  Pressable,
  StatusBar as SystemBars,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import type { Photo } from '@arcafold/core/library/model';

import { MemoryImage } from '../../modules/memory-image';
import { formatTaken } from '../library/timeline';
import type { Library } from '../library/use-library';

/** How long a photo stays in view before its original downloads, so a fast swipe skips it. */
const SETTLE_MS = 250;

const Page = memo(function Page({
  photo,
  thumbId,
  originalId,
  width,
  height,
  maxSide,
  requestThumbs,
  onTap,
}: {
  photo: Photo;
  thumbId: string | null;
  originalId: string | null;
  width: number;
  height: number;
  maxSide: number;
  requestThumbs: Library['requestThumbs'];
  onTap: () => void;
}) {
  useEffect(() => {
    if (!thumbId) requestThumbs([photo.id], true);
  }, [photo.id, thumbId, requestThumbs]);
  return (
    <Pressable
      onPress={onTap}
      style={{ width, height }}
      accessibilityLabel={`Photo taken ${formatTaken(photo.takenAt)}`}
    >
      {/* The preview shows at once; the original covers it once it has arrived. */}
      <MemoryImage imageId={thumbId} fit="contain" style={StyleSheet.absoluteFill} />
      {originalId ? (
        <MemoryImage
          imageId={originalId}
          fit="contain"
          maxSide={maxSide}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </Pressable>
  );
});

/**
 * A photo full screen, swiping left and right through the timeline. The original is
 * downloaded and decrypted for the photo in view, decoded no larger than the screen, and
 * freed when another one opens.
 */
export function Viewer({
  photos,
  start,
  library,
  onClose,
}: {
  photos: Photo[];
  start: number;
  library: Pick<Library, 'thumbs' | 'requestThumbs' | 'openOriginal'>;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const maxSide = Math.round(Math.max(width, height) * PixelRatio.get());
  const [index, setIndex] = useState(start);
  const [original, setOriginal] = useState<{ photoId: string; imageId: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [chrome, setChrome] = useState(true);
  const { thumbs, requestThumbs, openOriginal } = library;
  const photo = photos.at(index);

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => {
      back.remove();
    };
  }, [onClose]);

  useEffect(() => {
    if (!photo) return;
    let live = true;
    const timer = setTimeout(() => {
      openOriginal(photo.id).then(
        (imageId) => {
          if (live) setOriginal({ photoId: photo.id, imageId });
        },
        () => {
          if (live) setFailed(photo.id);
        },
      );
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [photo, openOriginal]);

  const onSwiped = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(event.nativeEvent.contentOffset.x / width);
      setIndex(Math.max(0, Math.min(photos.length - 1, next)));
    },
    [width, photos.length],
  );

  const toggleChrome = useCallback(() => {
    setChrome((shown) => !shown);
  }, []);

  return (
    <View style={styles.viewer}>
      <StatusBar style="light" hidden={!chrome} />
      <FlatList
        data={photos}
        horizontal
        pagingEnabled
        initialScrollIndex={start}
        getItemLayout={(_, at) => ({ length: width, offset: width * at, index: at })}
        keyExtractor={(item) => item.id}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onSwiped}
        extraData={[thumbs, original]}
        renderItem={({ item }) => (
          <Page
            photo={item}
            thumbId={thumbs.get(item.id) ?? null}
            originalId={original?.photoId === item.id ? original.imageId : null}
            width={width}
            height={height}
            maxSide={maxSide}
            requestThumbs={requestThumbs}
            onTap={toggleChrome}
          />
        )}
      />
      {chrome && photo ? (
        <View style={[styles.bar, { paddingTop: (SystemBars.currentHeight ?? 24) + 8 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={12}
            style={styles.close}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
          <View style={styles.barText}>
            <Text style={styles.date}>{formatTaken(photo.takenAt)}</Text>
            <Text style={styles.count}>
              {String(index + 1)} of {String(photos.length)}
              {failed === photo.id ? ' · The full photo couldn’t be loaded' : ''}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  viewer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#000' },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#fff', fontSize: 22 },
  barText: { flex: 1 },
  date: { color: '#fff', fontSize: 16, fontWeight: '600' },
  count: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 2 },
});
