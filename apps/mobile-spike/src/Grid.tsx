import { FlashList } from '@shopify/flash-list';
import type { FlashListRef } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { memo, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { TILE_COUNT, sealSamples, tileUri } from './grid-data';
import type { SealedPhoto } from './grid-data';
import { median } from './timing';

const COLUMNS = 4;
const ITEMS = Array.from({ length: TILE_COUNT }, (_, i) => i);
/** About a fast flick through a big library: 5,000 photos in 30 seconds. */
const SCROLL_SECONDS = 30;

export interface GridReport {
  tiles: number;
  decryptMs: number;
  frames: number;
  slowFrames: number;
  seconds: number;
}

const Tile = memo(function Tile(props: {
  photo: SealedPhoto;
  size: number;
  onDecrypt: (ms: number) => void;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const { photo, onDecrypt } = props;
  useEffect(() => {
    let live = true;
    const start = Date.now();
    tileUri(photo).then(
      (next) => {
        onDecrypt(Date.now() - start);
        if (live) setUri(next);
      },
      () => {
        onDecrypt(-1);
      },
    );
    return () => {
      live = false;
    };
  }, [photo, onDecrypt]);
  return (
    <View style={[styles.tile, { width: props.size, height: props.size }]}>
      {uri ? (
        <Image source={{ uri }} style={styles.fill} cachePolicy="memory" contentFit="cover" />
      ) : null}
    </View>
  );
});

/**
 * 5,000 encrypted tiles in a FlashList. Scroll by hand, or "Auto-scroll" from top to bottom
 * in 30 seconds, which counts JS frames over 25 ms (a smooth 60 Hz frame is 16.7 ms).
 */
export function Grid(props: { onDone: (report: GridReport) => void }) {
  const [samples, setSamples] = useState<SealedPhoto[] | null>(null);
  const [status, setStatus] = useState('Encrypting sample photos…');
  const [scrolling, setScrolling] = useState(false);
  const list = useRef<FlashListRef<number>>(null);
  const decryptTimes = useRef<number[]>([]);
  const [failed, setFailed] = useState(0);
  const { width, height } = useWindowDimensions();
  const size = Math.floor(width / COLUMNS);

  useEffect(() => {
    sealSamples().then(
      (sealed) => {
        setSamples(sealed);
        setStatus('Ready. Scroll by hand, or tap Auto-scroll.');
      },
      (error: unknown) => {
        setStatus(
          `Couldn't prepare photos: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
  }, []);

  const onDecrypt = useRef((ms: number) => {
    if (ms < 0) setFailed((n) => n + 1);
    else decryptTimes.current.push(ms);
  }).current;

  const autoScroll = () => {
    if (scrolling) return;
    setScrolling(true);
    decryptTimes.current = [];
    const total = Math.ceil(TILE_COUNT / COLUMNS) * size - height;
    const start = Date.now();
    let last = start;
    let frames = 0;
    let slowFrames = 0;
    const step = () => {
      const now = Date.now();
      frames += 1;
      if (now - last > 25) slowFrames += 1;
      last = now;
      const progress = Math.min(1, (now - start) / (SCROLL_SECONDS * 1000));
      list.current?.scrollToOffset({ offset: progress * total, animated: false });
      if (frames % 30 === 0) {
        setStatus(
          `Scrolling ${String(Math.round(progress * 100))}%, ${String(decryptTimes.current.length)} tiles decrypted, ${String(slowFrames)}/${String(frames)} slow frames`,
        );
      }
      if (progress < 1) {
        requestAnimationFrame(step);
        return;
      }
      setScrolling(false);
      props.onDone({
        tiles: decryptTimes.current.length,
        decryptMs: median(decryptTimes.current),
        frames,
        slowFrames,
        seconds: Math.round((Date.now() - start) / 1000),
      });
    };
    requestAnimationFrame(step);
  };

  return (
    <View style={styles.fill}>
      <Text style={styles.note}>
        {status}
        {failed ? ` (${String(failed)} tiles failed to decrypt)` : ''}
      </Text>
      {samples ? (
        <>
          <Pressable
            style={[styles.button, scrolling ? styles.disabled : null]}
            onPress={autoScroll}
          >
            <Text style={styles.buttonText}>Auto-scroll 5,000 photos</Text>
          </Pressable>
          <FlashList
            ref={list}
            data={ITEMS}
            numColumns={COLUMNS}
            keyExtractor={(i) => String(i)}
            renderItem={({ item }) => (
              <Tile photo={samples[item % samples.length]} size={size} onDecrypt={onDecrypt} />
            )}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  tile: { padding: 1, backgroundColor: '#e8e8e8' },
  note: { paddingHorizontal: 12, paddingVertical: 6, color: '#444' },
  button: { margin: 8, padding: 12, backgroundColor: '#1d4ed8', borderRadius: 8 },
  disabled: { opacity: 0.5 },
  buttonText: { color: 'white', textAlign: 'center', fontWeight: '600' },
});
