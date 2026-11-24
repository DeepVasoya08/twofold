import { Pressable, StyleSheet, Text, View } from 'react-native';

import { bottomInset } from '../../modules/system-bars';
import { Icon } from './icons';
import type { IconName } from './icons';
import { usePalette } from './theme';

export interface BarAction {
  key: string;
  label: string;
  icon: IconName;
  /** What a screen reader says, when the label alone isn't enough. */
  accessibilityLabel?: string;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/** The bar's height and how far it floats above the bottom edge. */
export const ACTION_BAR = 76;
const LIFT = 14;

/** How much room a list leaves at its end so its last row scrolls clear of the bar. */
export function actionBarSpace(): number {
  return bottomInset() + LIFT + ACTION_BAR + 12;
}

/**
 * The floating bar of icon buttons shown while photos are selected, in place of the tab bar:
 * the same shape as the viewer's, in the app's own colours. Delete is red.
 */
export function ActionBar({ actions }: { actions: readonly BarAction[] }) {
  const palette = usePalette();
  if (actions.length === 0) return null;
  return (
    <View
      accessibilityRole="toolbar"
      style={[
        styles.bar,
        {
          bottom: bottomInset() + LIFT,
          backgroundColor: palette.surface,
          borderColor: palette.border,
        },
      ]}
    >
      {actions.map((action) => {
        const ink = action.danger ? palette.error : palette.text;
        return (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel ?? action.label}
            accessibilityState={{ disabled: action.disabled === true }}
            disabled={action.disabled}
            onPress={action.onPress}
            style={({ pressed }) => [
              styles.action,
              action.disabled ? styles.disabled : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <Icon name={action.icon} size={22} color={ink} />
            <Text style={[styles.label, { color: ink }]} numberOfLines={1}>
              {action.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: ACTION_BAR,
    borderRadius: 30,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    elevation: 8,
    shadowColor: '#0b0e24',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  action: {
    flex: 1,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 22,
  },
  label: { fontSize: 12, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
});
