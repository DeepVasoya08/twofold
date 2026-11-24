import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
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
import { addsByUpload, canChangeAlbum, canShare, isViewOnly } from '@arcafold/core/library/albums';
import type { Album, Photo } from '@arcafold/core/library/model';
import { GONE, trashNote } from '@arcafold/core/library/trash';
import type { Session } from '@arcafold/core/account';

import { MemoryImage } from '../../modules/memory-image';
import { bottomInset } from '../../modules/system-bars';
import { albumChangeText } from '../library/album-text';
import { formatTaken } from '../library/timeline';
import {
  barActions,
  photoAlbums,
  photoFacts,
  viewerDay,
  viewerPlace,
} from '../library/viewer-text';
import { deleteTitle } from '../library/trash-text';
import type { Library } from '../library/use-library';
import { useAccount } from '../session/account';
import { FAVORITE, fonts } from '../theme';
import { Icon } from '../ui/icons';
import { Banner } from '../ui/kit';
import { useNotice } from '../ui/notice';
import { moveLabel } from '../session/forms';
import { Sheet, SheetOption } from '../ui/sheet';
import { usePalette } from '../ui/theme';
import { NameSheet, PickAlbumSheet } from './AlbumSheets';
import { ConfirmSheet } from './ConfirmSheet';
import { MoveSheet } from './MoveSheet';

type SpaceKeys = NonNullable<Session['otherSpace']>;

/** How long a photo stays in view before its original downloads, so a fast swipe skips it. */
const SETTLE_MS = 250;

/** The sharpest the original is decoded while zoomed in, so it doesn't blur. */
const ZOOMED_MAX_SIDE = 4096;

/** The viewer's red, readable on black, for Delete. */
const DANGER = '#ff8a80';

/** A round see-through button over the photo. */
function RoundButton({
  label,
  selected,
  onPress,
  children,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(selected === undefined ? {} : { accessibilityState: { selected } })}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.round, pressed ? styles.pressed : null]}
    >
      {children}
    </Pressable>
  );
}

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
  notThis,
  onLike,
  onSave,
  onShare,
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
    | 'setFavorite'
    | 'createAlbum'
    | 'deletePhotos'
  >;
  /** The album being swiped through, if it's one: its photos can be taken out of it. */
  album?: Album;
  /**
   * When swiping through someone's photos: says the photo in view isn't them, which takes it
   * out of their photos. `label` is the button's text ("Not Ada").
   */
  notThis?: { label: string; run: (photoId: string) => Promise<boolean> };
  /** Starts a search for photos that look like the one in view. */
  onLike?: (photoId: string) => void;
  /** Saves a copy of the photo in view to the phone's gallery. */
  onSave?: (photoId: string) => void;
  /** Shares the photo in view with someone, through an album. */
  onShare?: (photoId: string) => void;
  onClose: () => void;
}) {
  const { space, otherSpace } = useAccount();
  const notice = useNotice();
  const [filing, setFiling] = useState<'picking' | 'naming' | 'saving' | null>(null);
  const [moving, setMoving] = useState<'asking' | 'moving' | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [unlisting, setUnlisting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** The photo whose Details sheet is open: moving on to another closes it. */
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const palette = usePalette();
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

  const actions = barActions({
    share: onShare !== undefined && photo !== undefined && canShare([photo]),
    save: onSave !== undefined,
    file: canFile,
    similar: onLike !== undefined,
    move: canMove,
  });
  const inAlbums = photo ? photoAlbums(photo, library.albums) : [];

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
        <View style={[styles.top, { paddingTop: (SystemBars.currentHeight ?? 24) + 8 }]}>
          <RoundButton label="Close" onPress={onClose}>
            <Icon name="back" size={20} color="#ffffff" />
          </RoundButton>
          <View style={styles.topText}>
            <Text style={styles.day} numberOfLines={1}>
              {viewerDay(photo.takenAt)}
            </Text>
            <Text style={styles.place} numberOfLines={1}>
              {viewerPlace(photo.takenAt, Math.min(index, last), photos.length)}
              {failed === photo.id ? ' · Full photo couldn’t load' : ''}
            </Text>
          </View>
          {canFile ? (
            <RoundButton
              label={photo.favorite ? 'Remove from favorites' : 'Add to favorites'}
              selected={photo.favorite}
              onPress={() => {
                setMoveError(null);
                library.setFavorite(photo.id, !photo.favorite).catch(() => {
                  setMoveError('That didn’t save. Check your connection and try again.');
                });
              }}
            >
              <Icon name="heart" size={20} color={photo.favorite ? FAVORITE : '#9c9ea6'} />
            </RoundButton>
          ) : null}
          <RoundButton
            label="Details"
            onPress={() => {
              setDetailsFor(photo.id);
            }}
          >
            <Icon name="more" size={20} color="#ffffff" />
          </RoundButton>
        </View>
      ) : null}
      {chrome && photo && space ? (
        <View style={[styles.bottom, { paddingBottom: 14 + bottomInset() }]}>
          {moveError ? <Banner>{moveError}</Banner> : null}
          {actions.length > 0 ? (
            <View style={styles.bar}>
              {actions.map((action) => {
                const busy = filing !== null || moving !== null;
                const item = {
                  share: {
                    label: 'Share',
                    icon: 'share' as const,
                    run: () => {
                      onShare?.(photo.id);
                    },
                  },
                  save: {
                    label: 'Save',
                    icon: 'download' as const,
                    run: () => {
                      onSave?.(photo.id);
                    },
                  },
                  album: {
                    label: filing === 'saving' ? 'Saving…' : 'Album',
                    icon: 'albums' as const,
                    run: () => {
                      setMoveError(null);
                      setFiling('picking');
                    },
                  },
                  similar: {
                    label: 'Similar',
                    icon: 'similar' as const,
                    run: () => {
                      onLike?.(photo.id);
                    },
                  },
                  move: {
                    label:
                      moving === 'moving'
                        ? 'Moving…'
                        : space === 'private'
                          ? 'To library'
                          : 'Private',
                    icon: space === 'private' ? ('unlock' as const) : ('lock' as const),
                    run: move,
                  },
                  delete: {
                    label: 'Delete',
                    icon: 'trash' as const,
                    run: () => {
                      setMoveError(null);
                      setDeleting(true);
                    },
                  },
                }[action];
                const ink = action === 'delete' ? DANGER : '#ffffff';
                return (
                  <Pressable
                    key={action}
                    accessibilityRole="button"
                    accessibilityLabel={
                      action === 'move'
                        ? moveLabel(space)
                        : action === 'similar'
                          ? 'More like this'
                          : action === 'save'
                            ? 'Save to phone'
                            : action === 'share'
                              ? 'Share with someone'
                              : action === 'album'
                                ? 'Add to album'
                                : item.label
                    }
                    disabled={action !== 'save' && action !== 'similar' && busy}
                    onPress={item.run}
                    style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
                  >
                    <Icon name={item.icon} size={22} color={ink} />
                    <Text style={[styles.actionText, { color: ink }]} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}
      {detailsFor !== null && detailsFor === photo?.id ? (
        <Sheet
          title="Details"
          busy={unlisting}
          onCancel={() => {
            setDetailsFor(null);
          }}
        >
          <View style={styles.facts}>
            {photoFacts(photo).map((fact) => (
              <View key={fact.label} style={[styles.fact, { backgroundColor: palette.background }]}>
                <Text style={[styles.factLabel, { color: palette.muted }]}>{fact.label}</Text>
                <Text style={[styles.factValue, { color: palette.text }]} numberOfLines={2}>
                  {fact.value}
                </Text>
              </View>
            ))}
          </View>
          {inAlbums.length > 0 ? (
            <View style={styles.chips}>
              {inAlbums.map((title) => (
                <Text
                  key={title}
                  style={[
                    styles.chip,
                    { backgroundColor: palette.accentWash, color: palette.accent },
                  ]}
                  numberOfLines={1}
                >
                  {title}
                </Text>
              ))}
            </View>
          ) : null}
          {canTakeOut ? (
            <SheetOption
              label="Remove from this album"
              detail="The photo stays in your library"
              disabled={filing !== null || moving !== null}
              onPress={() => {
                setDetailsFor(null);
                void file(album, false);
              }}
            />
          ) : null}
          {notThis ? (
            <SheetOption
              label={unlisting ? 'Saving…' : notThis.label}
              disabled={unlisting}
              onPress={() => {
                setUnlisting(true);
                setMoveError(null);
                notThis.run(photo.id).then(
                  (done) => {
                    setUnlisting(false);
                    setDetailsFor(null);
                    if (!done)
                      setMoveError('That didn’t save. Check your connection and try again.');
                  },
                  () => {
                    setUnlisting(false);
                    setDetailsFor(null);
                    setMoveError('That didn’t save. Check your connection and try again.');
                  },
                );
              }}
            />
          ) : null}
        </Sheet>
      ) : null}
      {deleting && photo ? (
        <ConfirmSheet
          title={deleteTitle(1)}
          body={trashNote(1)}
          action="Delete"
          busyLabel="Deleting…"
          onCancel={() => {
            setDeleting(false);
          }}
          onConfirm={async () => {
            const result = await library.deletePhotos([photo.id]);
            if (result.done.length === 0) {
              throw result.error instanceof Error ? result.error : new FormError(GONE);
            }
            setDeleting(false);
            notice('Moved to Recently deleted.');
          }}
        />
      ) : null}
      {filing === 'picking' && photo ? (
        <PickAlbumSheet
          photos={[photo]}
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
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  round: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  pressed: { opacity: 0.6 },
  topText: { flex: 1, gap: 2 },
  day: { color: '#fff', fontFamily: fonts.display, fontSize: 18, letterSpacing: -0.3 },
  place: { color: 'rgba(255,255,255,0.72)', fontSize: 13 },
  bottom: { position: 'absolute', left: 12, right: 12, bottom: 0, gap: 10 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 76,
    borderRadius: 30,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(28,30,36,0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  action: { flex: 1, height: 64, alignItems: 'center', justifyContent: 'center', gap: 5 },
  actionText: { fontSize: 12, fontWeight: '600' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fact: {
    flexBasis: '48%',
    flexGrow: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 2,
  },
  factLabel: { fontSize: 12, fontWeight: '600' },
  factValue: { fontSize: 15, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    fontSize: 14,
    fontWeight: '600',
    overflow: 'hidden',
  },
});
