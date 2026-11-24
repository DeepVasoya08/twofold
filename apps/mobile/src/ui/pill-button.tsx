import { Pressable, StyleSheet, Text } from 'react-native';

import { Icon } from './icons';
import type { IconName } from './icons';
import { usePalette } from './theme';

/**
 * A rounded button with an icon and a short label, for a page's main actions under its title
 * (Add photos, Share, Save): filled in the accent for the first, outlined for the rest.
 */
export function PillButton({
  label,
  icon,
  filled = false,
  disabled = false,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  icon: IconName;
  filled?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  const palette = usePalette();
  const ink = filled ? palette.onAccent : palette.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        filled
          ? { backgroundColor: palette.accent, borderColor: palette.accent }
          : { backgroundColor: palette.surface, borderColor: palette.border },
        disabled ? styles.faded : pressed ? styles.pressed : null,
      ]}
    >
      <Icon name={icon} size={16} color={ink} />
      <Text style={[styles.label, { color: ink }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    paddingHorizontal: 18,
    borderRadius: 21,
    borderWidth: 1,
  },
  label: { fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.75 },
  faded: { opacity: 0.45 },
});
