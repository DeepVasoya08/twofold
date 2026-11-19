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

import { FormError } from '@arcafold/core/errors';
import { addsByUpload, canChangeAlbum, isViewOnly } from '@arcafold/core/library/albums';
import type { Album, Photo } from '@arcafold/core/library/model';
import type { Session } from '@arcafold/core/account';

import { MemoryImage } from '../../modules/memory-image';
import { bottomInset } from '../../modules/system-bars';
import { albumChangeText } from '../library/album-text';
import { formatTaken } from '../library/timeline';
import type { Library } from '../library/use-library';
import { useAccount } from '../session/account';
import { Banner } from '../ui/kit';
import { useNotice } from '../ui/notice';
import { moveLabel } from '../session/forms';
import { NameSheet, PickAlbumSheet } from './AlbumSheets';
import { MoveSheet } from './MoveSheet';

type SpaceKeys = NonNullable<Session['otherSpace']>;

/** How long a photo stays in view before its original downloads, so a fast swipe skips it. */
const SETTLE_MS = 250;

/** The sharpest the original is decoded while zoomed in, so it doesn't blur. */
const ZOOMED_MAX_SIDE = 4096;

const Page = memo(function Page({
  photo,
  thumbId,
  originalId,
  width,
  height,
  maxSide,
  requestThumbs,
  onTap,
  onZoom,
}: {
  photo: Photo;
  thumbId: string | null;
  originalId: string | null;
  width: number;
  height: number;
  maxSide: number;
  requestThumbs: Library['requestThumbs'];
  onTap: () => void;
  onZoom: (zoomed: boolean) => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    if (!thumbId) requestThumbs([photo.id], true);
  }, [photo.id, thumbId, requestThumbs]);
  return (
    <View
      style={{ width, height }}
      accessibilityLabel={`Photo taken ${formatTaken(photo.takenAt)}`}
    >
      {/* The preview shows at once and the original replaces it when it arrives, keeping the
          zoom. Zoomed in, the original is decoded sharper. */}
      <MemoryImage
        imageId={originalId ?? thumbId}
        fit="contain"
        zoomable
        maxSide={zoomed && originalId ? Math.max(maxSide, ZOOMED_MAX_SIDE) : maxSide}
        onTap={onTap}
        onZoom={(event) => {
          setZoomed(event.nativeEvent.zoomed);
          onZoom(event.nativeEvent.zoomed);
        }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
});

/**
 * A photo full screen, swiping left and right through the timeline (or an album). The
 * original is downloaded and decrypted for the photo in view, decoded no larger than the
 * screen, and freed when another one opens.
 */
export function Viewer({
  photos,
  start,
  library,
  album,
  onClose,
}: {
  photos: Photo[];
  start: number;
  library: Pick<
    Library,
    | 'thumbs'
    | 'requestThumbs'
    | 'openOriginal'
    | 'movePhoto'
    | 'albums'
    | 'setInAlbum'
    | 'createAlbum'
  >;
  /** The album being swiped through, if it's one: its photos can be taken out of it. */
  album?: Album;
  onClose: () => void;
}) {
  const { space, otherSpace } = useAccount();
  const notice = useNotice();
  const [filing, setFiling] = useState<'picking' | 'naming' | 'saving' | null>(null);
  const [moving, setMoving] = useState<'asking' | 'moving' | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const { width, height } = useWindowDimensions();
  const maxSide = Math.round(Math.max(width, height) * PixelRatio.get());
  const [index, setIndex] = useState(start);
  const [original, setOriginal] = useState<{ photoId: string; imageId: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [chrome, setChrome] = useState(true);
  const { thumbs, requestThumbs, openOriginal, movePhoto } = library;
  const last = photos.length - 1;
  const photo = photos.at(Math.min(index, last));

  // After a move the list is one shorter: the next photo takes this one's place, and when
  // the last one has gone there is nothing left to show.
  useEffect(() => {
    if (photos.length === 0) onClose();
  }, [photos.length, onClose]);

  const canMove = photo !== undefined && photo.library === undefined && !photo.viewOnly;
  const moveWith = (keys: SpaceKeys) => {
    if (!photo) return;
    setMoving('moving');
    setMoveError(null);
    movePhoto(photo.id, keys).then(
      () => {
        setMoving(null);
      },
      (error: unknown) => {
        setMoving(null);
        setMoveError(
          error instanceof FormError ? error.message : 'The photo couldn’t be moved. Try again.',
        );
      },
    );
  };
  const canFile = photo !== undefined && !isViewOnly(photo);
  // Out of your own albums, or out of one shared with you that you may add to.
  const canTakeOut =
    photo !== undefined &&
    album !== undefined &&
    ((canFile && canChangeAlbum(album)) ||
      (addsByUpload(album) && photo.library === album.library));
  const { setInAlbum, createAlbum } = library;
  /** Puts the photo in view in an album, or takes it out, and says how that went. */
  const file = (target: Album, included: boolean): Promise<void> => {
    if (!photo) return Promise.resolve();
    setFiling('saving');
    setMoveError(null);
    return setInAlbum([photo.id], target, included).then(
      (result) => {
        setFiling(null);
        const text = albumChangeText(result, target.title, included);
        if (result.done.length > 0) notice(text);
        else setMoveError(text);
      },
      () => {
        setFiling(null);
        setMoveError(albumChangeText({ done: [], failed: [photo.id] }, target.title, included));
      },
    );
  };

  const move = () => {
    if (!photo || !space) return;
    if (otherSpace) moveWith(otherSpace);
    else setMoving('asking');
  };

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

  // While a photo is zoomed, one finger pans it instead of swiping to the next.
  const [zoomed, setZoomed] = useState(false);
  const onZoom = useCallback((now: boolean) => {
    setZoomed(now);
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
        scrollEnabled={!zoomed}
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
            onZoom={onZoom}
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
      {chrome && photo && space && (canMove || canFile || canTakeOut) ? (
        <View style={[styles.actions, { paddingBottom: 24 + bottomInset() }]}>
          {moveError ? <Banner>{moveError}</Banner> : null}
          <View style={styles.actionRow}>
            {canFile ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ busy: filing === 'saving' }}
                disabled={filing !== null || moving !== null}
                onPress={() => {
                  setMoveError(null);
                  setFiling('picking');
                }}
                style={styles.action}
              >
                <Text style={styles.actionText}>
                  {filing === 'saving' ? 'Saving…' : 'Add to album'}
                </Text>
              </Pressable>
            ) : null}
            {canTakeOut ? (
              <Pressable
                accessibilityRole="button"
                disabled={filing !== null || moving !== null}
                onPress={() => {
                  void file(album, false);
                }}
                style={styles.action}
              >
                <Text style={styles.actionText}>Remove from album</Text>
              </Pressable>
            ) : null}
            {canMove ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ busy: moving === 'moving' }}
                disabled={moving !== null || filing !== null}
                onPress={move}
                style={styles.action}
              >
                <Text style={styles.actionText}>
                  {moving === 'moving' ? 'Moving…' : moveLabel(space)}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      {filing === 'picking' && photo ? (
        <PickAlbumSheet
          photo={photo}
          albums={library.albums}
          onPick={(target) => {
            void file(target, true);
          }}
          onNew={() => {
            setFiling('naming');
          }}
          onCancel={() => {
            setFiling(null);
          }}
        />
      ) : null}
      {filing === 'naming' ? (
        <NameSheet
          title="New album"
          action="Create and add"
          onSave={async (name) => {
            const made = await createAlbum(name);
            await file(made, true);
          }}
          onCancel={() => {
            setFiling(null);
          }}
        />
      ) : null}
      {moving === 'asking' && space ? (
        <MoveSheet
          space={space}
          onCancel={() => {
            setMoving(null);
          }}
          onUnlocked={moveWith}
        />
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
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 10,
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  action: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  actionText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
