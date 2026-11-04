import { useState } from 'react';
import type { ReactNode, Ref } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { TextInputInstance, TextInputProps } from 'react-native';

import { errorMessage } from '@arcafold/core/errors';
import { passwordStrength } from '@arcafold/core/password';

import logo from '../../assets/logo.png';
import { strengthTone } from '../session/forms';
import { usePalette } from './theme';

/**
 * A full screen with a title. It shrinks to the space above the keyboard and scrolls, so the
 * field being typed in stays in view on any screen size. (The app draws edge to edge on
 * Android, where the system no longer resizes the window for the keyboard, so this does.)
 */
export function Screen({
  title,
  subtitle,
  showLogo = false,
  children,
}: {
  title: string;
  subtitle?: string;
  showLogo?: boolean;
  children: ReactNode;
}) {
  const palette = usePalette();
  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: palette.background }]}
      behavior="padding"
    >
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        {showLogo ? (
          <Image source={logo} style={styles.logo} accessibilityLabel="Arcafold" />
        ) : null}
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
  ref,
  ...input
}: TextInputProps & { label: string; error?: string | null; ref?: Ref<TextInputInstance> }) {
  const palette = usePalette();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      <TextInput
        ref={ref}
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

const STRENGTH_BARS = [1, 2, 3, 4] as const;

/** The password's strength as four coloured bars and a label, as on the web. */
export function StrengthMeter({ password }: { password: string }) {
  const palette = usePalette();
  const { score, label } = passwordStrength(password);
  const colour = palette[strengthTone(score)];
  return (
    <View
      style={styles.strength}
      accessibilityRole="text"
      accessibilityLabel={`Password strength: ${label}`}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.strengthBars}>
        {STRENGTH_BARS.map((bar) => (
          <View
            key={bar}
            style={[styles.strengthBar, { backgroundColor: bar <= score ? colour : palette.track }]}
          />
        ))}
      </View>
      <Text style={[styles.strengthLabel, { color: colour }]}>{label}</Text>
    </View>
  );
}

/** A tick box with its label; the tick shows when it's on. */
export function CheckBox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => {
        onChange(!checked);
      }}
      style={styles.check}
    >
      <View
        style={[
          styles.box,
          {
            borderColor: palette.accent,
            backgroundColor: checked ? palette.accent : 'transparent',
          },
        ]}
      >
        {checked ? <View style={[styles.tick, { borderColor: palette.onAccent }]} /> : null}
      </View>
      <Text style={[styles.checkLabel, { color: palette.text }]}>{label}</Text>
    </Pressable>
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
  screen: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 56, gap: 16 },
  logo: { width: 72, height: 72, alignSelf: 'center', marginBottom: 8 },
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
  strength: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: -6 },
  strengthBars: { flex: 1, flexDirection: 'row', gap: 4 },
  strengthBar: { flex: 1, height: 6, borderRadius: 3 },
  strengthLabel: { minWidth: 72, textAlign: 'right', fontSize: 14, fontWeight: '700' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  checkLabel: { flex: 1, fontSize: 15, lineHeight: 21 },
  box: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A tick drawn as the bottom-right corner of a box, turned 45 degrees.
  tick: {
    width: 7,
    height: 13,
    borderRightWidth: 2.5,
    borderBottomWidth: 2.5,
    transform: [{ rotate: '45deg' }],
    marginTop: -3,
  },
});
