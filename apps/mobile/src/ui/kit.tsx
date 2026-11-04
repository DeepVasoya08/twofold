import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { TextInputProps } from 'react-native';

import { errorMessage } from '@arcafold/core/errors';

import { usePalette } from './theme';

/** A full screen with a title, scrolling above the keyboard. */
export function Screen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const palette = usePalette();
  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: palette.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={[styles.body, { color: palette.muted }]}>{subtitle}</Text> : null}
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Field({
  label,
  error,
  ...input
}: TextInputProps & { label: string; error?: string | null }) {
  const palette = usePalette();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={palette.muted}
        style={[
          styles.input,
          { color: palette.text, borderColor: error ? palette.error : palette.border },
          { backgroundColor: palette.surface },
        ]}
        {...input}
      />
      {error ? <Text style={[styles.small, { color: palette.error }]}>{error}</Text> : null}
    </View>
  );
}

export function Button({
  label,
  busyLabel,
  busy = false,
  kind = 'primary',
  onPress,
}: {
  label: string;
  busyLabel?: string;
  busy?: boolean;
  kind?: 'primary' | 'link';
  onPress: () => void;
}) {
  const palette = usePalette();
  if (kind === 'link') {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} disabled={busy} style={styles.link}>
        <Text style={[styles.linkText, { color: palette.accent }]}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      onPress={onPress}
      disabled={busy}
      style={[styles.button, { backgroundColor: palette.accent, opacity: busy ? 0.7 : 1 }]}
    >
      {busy ? <ActivityIndicator color={palette.onAccent} /> : null}
      <Text style={[styles.buttonText, { color: palette.onAccent }]}>
        {busy && busyLabel ? busyLabel : label}
      </Text>
    </Pressable>
  );
}

export function Note({ children, error = false }: { children: ReactNode; error?: boolean }) {
  const palette = usePalette();
  return (
    <Text
      style={[styles.small, { color: error ? palette.error : palette.muted }]}
      accessibilityLiveRegion={error ? 'polite' : 'none'}
    >
      {children}
    </Text>
  );
}

/** Runs a form's action once at a time, keeping its busy state and the message to show. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    action()
      .catch((caught: unknown) => {
        setError(errorMessage(caught));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return { busy, error, setError, run };
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  small: { fontSize: 14, lineHeight: 20 },
  button: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingVertical: 14,
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  link: { paddingVertical: 8, alignItems: 'center' },
  linkText: { fontSize: 15, fontWeight: '600' },
});
