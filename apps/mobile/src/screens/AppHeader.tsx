import { createContext } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAccount } from '../session/account';
import { fonts } from '../theme';
import { LogoMark } from '../ui/brand';
import { Icon } from '../ui/icons';
import type { IconName } from '../ui/icons';
import { usePalette } from '../ui/theme';

/** Opens search; the Photos tab's search field opens it. */
export const OpenSearch = createContext<(() => void) | null>(null);

/**
 * The pinned row under a top screen's title: a search field and, beside it, the button that
 * picks the screen's view. The field either filters the screen as you type (`onQuery`) or
 * opens the search screen (`onOpen`, on Photos, whose search looks inside photos).
 */
export interface SearchRow {
  placeholder: string;
  query?: string;
  onQuery?: (query: string) => void;
  onOpen?: () => void;
  view?: { icon: IconName; label: string; onPress: () => void };
}

/**
 * The bar across the top of the library's screens: the logo (or a back button), the
 * screen's title, its own buttons, then Lock and your initial, which opens Settings. Top
 * screens add a search row under it (`search`), which stays put while the screen scrolls.
 */
export function AppHeader({
  title,
  initial,
  onBack,
  onSettings,
  search,
  children,
}: {
  title: string;
  initial: string;
  /** Shows a back button instead of the logo. */
  onBack?: () => void;
  onSettings: () => void;
  search?: SearchRow;
  /** The screen's own buttons, before Lock. */
  children?: ReactNode;
}) {
  const { lock } = useAccount();
  const palette = usePalette();
  return (
    <View>
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
      {search ? <SearchField row={search} /> : null}
    </View>
  );
}

function SearchField({ row }: { row: SearchRow }) {
  const palette = usePalette();
  const field = [styles.field, { backgroundColor: palette.surface, borderColor: palette.border }];
  return (
    <View style={styles.searchRow}>
      {row.onQuery ? (
        <View style={field}>
          <Icon name="search" size={17} color={palette.muted} />
          <TextInput
            value={row.query ?? ''}
            onChangeText={row.onQuery}
            placeholder={row.placeholder}
            placeholderTextColor={palette.muted}
            accessibilityLabel={row.placeholder}
            returnKeyType="search"
            autoCorrect={false}
            style={[styles.fieldInput, { color: palette.text }]}
          />
          {row.query ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={10}
              onPress={() => {
                row.onQuery?.('');
              }}
            >
              <Text style={[styles.clear, { color: palette.muted }]}>✕</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <Pressable
          accessibilityRole="search"
          accessibilityLabel={row.placeholder}
          onPress={row.onOpen}
          style={field}
        >
          <Icon name="search" size={17} color={palette.muted} />
          <Text style={[styles.fieldPlaceholder, { color: palette.muted }]} numberOfLines={1}>
            {row.placeholder}
          </Text>
        </Pressable>
      )}
      {row.view ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={row.view.label}
          onPress={row.view.onPress}
          hitSlop={4}
          style={[
            styles.viewButton,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Icon name={row.view.icon} size={18} color={palette.text} />
        </Pressable>
      ) : null}
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  field: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
  fieldInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  fieldPlaceholder: { flex: 1, fontSize: 15 },
  clear: { fontSize: 15, fontWeight: '600' },
  viewButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
