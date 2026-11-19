import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Palette } from './theme';

/** A titled card of rows, as in Settings. */
export function Section({
  title,
  palette,
  children,
}: {
  title: string;
  palette: Palette;
  children: ReactNode;
}) {
  return (
    <View style={rowStyles.section}>
      <Text style={[rowStyles.sectionTitle, { color: palette.muted }]} accessibilityRole="header">
        {title}
      </Text>
      <View
        style={[rowStyles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
      >
        {children}
      </View>
    </View>
  );
}

/** One line of a section: a title, a detail under it, and something to do on the right. */
export function Row({
  title,
  detail,
  palette,
  action,
}: {
  title: string;
  detail?: string;
  palette: Palette;
  action?: ReactNode;
}) {
  return (
    <View style={rowStyles.row}>
      <View style={rowStyles.rowText}>
        <Text style={[rowStyles.rowTitle, { color: palette.text }]}>{title}</Text>
        {detail ? (
          <Text style={[rowStyles.rowDetail, { color: palette.muted }]}>{detail}</Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

/** A small rounded button at the end of a row. */
export function PillButton({
  label,
  accessibilityLabel,
  danger = false,
  disabled = false,
  palette,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  danger?: boolean;
  disabled?: boolean;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        rowStyles.pill,
        { borderColor: danger ? palette.error : palette.border, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <Text style={[rowStyles.pillText, { color: danger ? palette.error : palette.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export const rowStyles = StyleSheet.create({
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginLeft: 4,
  },
  card: { borderWidth: 1, borderRadius: 18, paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowPad: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowDetail: { fontSize: 14, lineHeight: 20 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  pillText: { fontSize: 14, fontWeight: '600' },
});
