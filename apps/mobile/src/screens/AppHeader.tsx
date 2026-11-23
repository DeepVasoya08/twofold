import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';

import { useAccount } from '../session/account';
import { fonts } from '../theme';
import { LogoMark } from '../ui/brand';
import { Icon } from '../ui/icons';
import { usePalette } from '../ui/theme';

/** Opens search; the library's top screens show a search button when it's given. */
export const OpenSearch = createContext<(() => void) | null>(null);

/**
 * The bar across the top of the library's screens: the logo (or a back button), the
 * screen's title, its own buttons, search (on the top screens), then Lock and your initial,
 * which opens Settings.
 */
export function AppHeader({
  title,
  initial,
  onBack,
  onSettings,
  children,
}: {
  title: string;
  initial: string;
  /** Shows a back button instead of the logo. */
  onBack?: () => void;
  onSettings: () => void;
  /** The screen's own buttons, before Lock. */
  children?: ReactNode;
}) {
  const { lock } = useAccount();
  const palette = usePalette();
  const openSearch = useContext(OpenSearch);
  return (
    <View style={[styles.header, { paddingTop: (StatusBar.currentHeight ?? 24) + 12 }]}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={10}
          style={styles.back}
        >
          <Text style={[styles.backText, { color: palette.text }]}>‹</Text>
        </Pressable>
      ) : (
        <View style={styles.logo}>
          <LogoMark size={24} />
        </View>
      )}
      <Text
        style={[styles.title, { color: palette.text }]}
        accessibilityRole="header"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {title}
      </Text>
      {children}
      {openSearch && !onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search"
          onPress={openSearch}
          hitSlop={6}
          style={[styles.round, { borderColor: palette.border }]}
        >
          <Icon name="search" size={17} color={palette.text} />
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={lock}
        style={[styles.pill, { borderColor: palette.border }]}
      >
        <Text style={[styles.pillText, { color: palette.text }]}>Lock</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Settings"
        onPress={onSettings}
        style={[styles.avatar, { backgroundColor: palette.surface, borderColor: palette.border }]}
      >
        <Text style={[styles.avatarText, { color: palette.text }]}>{initial}</Text>
      </Pressable>
    </View>
  );
}

/**
 * A rounded button in the header: filled for the screen's main action, red for one that
 * deletes (which always asks first), so the accent stays for adding and opening.
 */
export function HeaderButton({
  label,
  accessibilityLabel,
  filled = false,
  danger = false,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  filled?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      hitSlop={6}
      style={[
        styles.pill,
        danger
          ? { borderColor: palette.error }
          : filled
            ? { borderWidth: 0, backgroundColor: palette.accent }
            : { borderColor: palette.border },
      ]}
    >
      <Text
        style={[
          styles.pillText,
          { color: danger ? palette.error : filled ? palette.onAccent : palette.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The bar across the top while photos are selected: how many, a way out, and what can be
 * done with them (`children`). Back leaves selecting too (the screen handles it).
 */
export function SelectionHeader({
  count,
  onCancel,
  children,
}: {
  count: number;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View style={[styles.header, { paddingTop: (StatusBar.currentHeight ?? 24) + 12 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop selecting"
        onPress={onCancel}
        hitSlop={10}
        style={styles.back}
      >
        <Text style={[styles.closeText, { color: palette.text }]}>✕</Text>
      </Pressable>
      <Text
        style={[styles.title, { color: palette.text }]}
        accessibilityRole="header"
        accessibilityLiveRegion="polite"
        numberOfLines={1}
      >
        {count === 0 ? 'Select photos' : `${count.toLocaleString('en-US')} selected`}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  closeText: { fontSize: 22, fontWeight: '400' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  logo: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  back: { width: 28, height: 34, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 34, lineHeight: 36, fontWeight: '300' },
  title: { flex: 1, fontFamily: fonts.display, fontSize: 24, letterSpacing: -0.5 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  pillText: { fontSize: 14, fontWeight: '600' },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 15, fontWeight: '700' },
  round: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
