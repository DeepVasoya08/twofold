import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { BackHandler, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from 'react-native';

import { bottomInset } from '../../modules/system-bars';
import { fonts } from '../theme';
import { usePalette } from './theme';

/**
 * A panel that slides up over the screen, with a title and what to choose or type. Drawn in
 * the app's own window (not a dialog window), so screenshot blocking covers it too. The back
 * button and a tap outside close it, unless it's busy.
 */
export function Sheet({
  title,
  body,
  busy = false,
  onCancel,
  children,
}: {
  title: string;
  body?: string;
  busy?: boolean;
  onCancel: () => void;
  children: ReactNode;
}) {
  const palette = usePalette();
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!busy) onCancel();
      return true;
    });
    return () => {
      back.remove();
    };
  }, [busy, onCancel]);
  return (
    <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
      <Pressable
        style={styles.dismiss}
        accessibilityLabel="Close"
        onPress={busy ? undefined : onCancel}
      />
      <View
        style={[
          styles.sheet,
          { backgroundColor: palette.surface, paddingBottom: 24 + bottomInset() },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: palette.border }]} />
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          {title}
        </Text>
        {body ? <Text style={[styles.body, { color: palette.muted }]}>{body}</Text> : null}
        {children}
      </View>
    </KeyboardAvoidingView>
  );
}

/** One choice in a sheet: a full-width row, red when it can't be undone. */
export function SheetOption({
  label,
  detail,
  danger = false,
  disabled = false,
  onPress,
}: {
  label: string;
  detail?: string;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        { borderColor: palette.border, opacity: disabled ? 0.5 : 1 },
        pressed ? { backgroundColor: palette.track } : null,
      ]}
    >
      <Text style={[styles.optionLabel, { color: danger ? palette.error : palette.text }]}>
        {label}
      </Text>
      {detail ? (
        <Text style={[styles.optionDetail, { color: palette.muted }]}>{detail}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  dismiss: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 14,
    maxHeight: '85%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2 },
  title: { fontFamily: fonts.display, fontSize: 22, letterSpacing: -0.3 },
  body: { fontSize: 15, lineHeight: 21 },
  option: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14 },
  optionLabel: { fontSize: 16, fontWeight: '600' },
  optionDetail: { fontSize: 13, marginTop: 2 },
});
