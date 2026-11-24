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

import eyeOff from '../../assets/eye-off.png';
import eye from '../../assets/eye.png';
import { strengthTone } from '../session/forms';
import { fonts } from '../theme';
import { ArchArt, LogoMark } from './brand';
import { usePalette } from './theme';

/**
 * A full screen with a title. It shrinks to the space above the keyboard and scrolls, so the
 * field being typed in stays in view on any screen size. (The app draws edge to edge on
 * Android, where the system no longer resizes the window for the keyboard, so this does.)
 * A `branded` screen (sign-in, sign-up, unlock) has the arch artwork and the logo at its top,
 * and its form on a card.
 */
export function Screen({
  title,
  subtitle,
  branded = false,
  children,
}: {
  title: string;
  subtitle?: string;
  branded?: boolean;
  children: ReactNode;
}) {
  const palette = usePalette();
  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: palette.background }]}
      behavior="padding"
    >
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        {branded ? (
          <View style={styles.brand}>
            <ArchArt />
            <View style={styles.wordmark}>
              <LogoMark size={20} />
              <Text style={[styles.brandName, { color: palette.text }]}>Arcafold</Text>
            </View>
          </View>
        ) : null}
        <Text
          style={[styles.title, branded && styles.titleCentred, { color: palette.text }]}
          accessibilityRole="header"
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.body, branded && styles.bodyCentred, { color: palette.muted }]}>
            {subtitle}
          </Text>
        ) : null}
        {branded ? (
          <View
            style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
          >
            {children}
          </View>
        ) : (
          children
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * A labelled text box. Its error shows under it and turns its border red. A `secure` field
 * hides what's typed, with an eye button to show it.
 */
export function Field({
  label,
  error,
  secure = false,
  ref,
  ...input
}: Omit<TextInputProps, 'secureTextEntry'> & {
  label: string;
  error?: string | null;
  secure?: boolean;
  ref?: Ref<TextInputInstance>;
}) {
  const palette = usePalette();
  const [shown, setShown] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      <View
        style={[
          styles.inputRow,
          {
            borderColor: error ? palette.error : palette.border,
            backgroundColor: palette.background,
          },
        ]}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={palette.muted}
          style={[styles.input, { color: palette.text }]}
          secureTextEntry={secure && !shown}
          autoCorrect={secure ? false : input.autoCorrect}
          {...input}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shown ? 'Hide password' : 'Show password'}
            onPress={() => {
              setShown((current) => !current);
            }}
            hitSlop={8}
            style={styles.eye}
          >
            <Image
              source={shown ? eyeOff : eye}
              style={[styles.eyeIcon, { tintColor: palette.muted }]}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={[styles.small, { color: palette.error }]}>{error}</Text> : null}
    </View>
  );
}

/** A form's problem, shown where it can't be missed: a red box with a warning mark. */
export function Banner({ children }: { children: ReactNode }) {
  const palette = usePalette();
  return (
    <View
      style={[styles.banner, { backgroundColor: palette.errorSoft, borderColor: palette.error }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <View style={[styles.bannerMark, { backgroundColor: palette.error }]}>
        <Text style={[styles.bannerMarkText, { color: palette.errorSoft }]}>!</Text>
      </View>
      <Text style={[styles.bannerText, { color: palette.text }]}>{children}</Text>
    </View>
  );
}

export function Button({
  label,
  busyLabel,
  busy = false,
  disabled = false,
  kind = 'primary',
  onPress,
}: {
  label: string;
  busyLabel?: string;
  busy?: boolean;
  /** Greyed out until something is chosen. */
  disabled?: boolean;
  /** `danger` is for a button that deletes: red, never the accent. */
  kind?: 'primary' | 'secondary' | 'danger' | 'link';
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
  // On red, dark themes' light red takes dark text; light theme's deep red takes white.
  const ink =
    kind === 'secondary'
      ? palette.accent
      : kind === 'danger'
        ? palette.dark
          ? palette.background
          : '#ffffff'
        : palette.onAccent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy || disabled }}
      onPress={onPress}
      disabled={busy || disabled}
      style={[
        styles.button,
        kind === 'secondary'
          ? { borderWidth: 1.5, borderColor: palette.accent }
          : { backgroundColor: kind === 'danger' ? palette.error : palette.accent },
        { opacity: disabled ? 0.45 : busy ? 0.7 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={ink} /> : null}
      <Text style={[styles.buttonText, { color: ink }]}>
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
  brand: { alignItems: 'center', gap: 22, marginBottom: 8 },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandName: { fontFamily: fonts.display, fontSize: 20, letterSpacing: -0.3 },
  title: { fontFamily: fonts.display, fontSize: 30, letterSpacing: -0.6 },
  titleCentred: { textAlign: 'center' },
  body: { fontSize: 16, lineHeight: 22 },
  bodyCentred: { textAlign: 'center', marginBottom: 4 },
  card: { borderWidth: 1, borderRadius: 20, padding: 20, gap: 16 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12 },
  input: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  eye: { paddingHorizontal: 14, paddingVertical: 10 },
  eyeIcon: { width: 22, height: 22 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  bannerMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerMarkText: { fontSize: 14, fontWeight: '800' },
  bannerText: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '500' },
  small: { fontSize: 14, lineHeight: 20 },
  button: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 15,
    paddingHorizontal: 20,
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
