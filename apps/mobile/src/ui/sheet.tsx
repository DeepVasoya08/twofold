import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { BackHandler, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from 'react-native';

import { bottomInset } from '../../modules/system-bars';
import { fonts } from '../theme';
import { usePalette } from './theme';

/**
 * A card that floats up over the screen, clear of its edges, with a title, a close button and
 * what to choose or type. Drawn in the app's own window (not a dialog window), so screenshot
 * blocking covers it too. The back button, the close button and a tap outside close it,
 * unless it's busy.
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
          {
            backgroundColor: palette.surface,
            borderColor: palette.border,
            marginBottom: 8 + bottomInset(),
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: palette.border }]} />
        <View style={styles.top}>
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
            {title}
          </Text>
          {busy ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              onPress={onCancel}
              style={[styles.close, { backgroundColor: palette.track }]}
            >
              <Text style={[styles.closeText, { color: palette.text }]}>✕</Text>
            </Pressable>
          )}
        </View>
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
    backgroundColor: 'rgba(8,10,30,0.55)',
  },
  dismiss: { flex: 1 },
  sheet: {
    marginHorizontal: 8,
    borderRadius: 30,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 22,
    gap: 14,
    maxHeight: '85%',
    elevation: 12,
    shadowColor: '#0b0e24',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, fontFamily: fonts.display, fontSize: 22, letterSpacing: -0.3 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { fontSize: 15, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  option: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14 },
  optionLabel: { fontSize: 16, fontWeight: '600' },
  optionDetail: { fontSize: 13, marginTop: 2 },
});
