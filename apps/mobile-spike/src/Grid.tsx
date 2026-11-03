import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { memo, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';

import { TILE_COUNT, sealSamples, tileUri } from './grid-data';
import type { SealedPhoto } from './grid-data';
import { median } from './timing';

const COLUMNS = 4;
const ITEMS = Array.from({ length: TILE_COUNT }, (_, i) => i);

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
    void tileUri(photo).then((next) => {
      onDecrypt(Date.now() - start);
      if (live) setUri(next);
    });
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
 * 5,000 encrypted tiles in a FlashList. "Auto-scroll" scrolls top to bottom in about 20
 * seconds and counts JS frames that took over 25 ms (a smooth 60 Hz frame is 16.7 ms).
 */
export function Grid(props: { onDone: (report: GridReport) => void }) {
  const [samples, setSamples] = useState<SealedPhoto[] | null>(null);
  const list = useRef<FlashListRef<number>>(null);
  const decryptTimes = useRef<number[]>([]);
  const { width, height } = useWindowDimensions();
  const size = Math.floor(width / COLUMNS);

  useEffect(() => {
    void sealSamples().then(setSamples);
  }, []);

  const onDecrypt = useRef((ms: number) => {
    decryptTimes.current.push(ms);
  }).current;

  const autoScroll = () => {
    const total = Math.ceil(TILE_COUNT / COLUMNS) * size - height;
    const seconds = 20;
    const start = Date.now();
    let last = start;
    let frames = 0;
    let slowFrames = 0;
    const step = () => {
      const now = Date.now();
      frames += 1;
      if (now - last > 25) slowFrames += 1;
      last = now;
      const progress = Math.min(1, (now - start) / (seconds * 1000));
      list.current?.scrollToOffset({ offset: progress * total, animated: false });
      if (progress < 1) {
        requestAnimationFrame(step);
        return;
      }
      props.onDone({
        tiles: decryptTimes.current.length,
        decryptMs: median(decryptTimes.current),
        frames,
        slowFrames,
        seconds,
      });
    };
    requestAnimationFrame(step);
  };

  if (!samples) return <Text style={styles.note}>Encrypting sample photos…</Text>;
  return (
    <View style={styles.fill}>
      <Pressable style={styles.button} onPress={autoScroll}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  tile: { padding: 1, backgroundColor: '#e8e8e8' },
  note: { padding: 16 },
  button: { margin: 8, padding: 12, backgroundColor: '#1d4ed8', borderRadius: 8 },
  buttonText: { color: 'white', textAlign: 'center', fontWeight: '600' },
});
