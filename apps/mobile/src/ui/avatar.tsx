import { StyleSheet, Text, View } from 'react-native';

import { MemoryImage } from '../../modules/memory-image';
import { fonts } from '../theme';
import { initialOf } from './avatar-text';

/**
 * Your round avatar: your profile photo (from memory) or, without one, your initial on a
 * plain colour.
 */
export function Avatar({
  imageId,
  name,
  size,
  background,
  ink,
  borderColor,
}: {
  imageId: string | null;
  name: string;
  size: number;
  background: string;
  ink: string;
  borderColor?: string;
}) {
  return (
    <View
      style={[
        styles.round,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: background,
          ...(borderColor ? { borderColor, borderWidth: Math.max(1, size / 26) } : {}),
        },
      ]}
    >
      {imageId ? (
        <MemoryImage imageId={imageId} fit="cover" maxSide={512} style={StyleSheet.absoluteFill} />
      ) : (
        <Text style={[styles.initial, { color: ink, fontSize: size * 0.42 }]}>
          {initialOf(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  round: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: fonts.display },
});
