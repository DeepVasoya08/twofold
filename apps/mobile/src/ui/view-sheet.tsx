import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { Sheet } from './sheet';
import { usePalette } from './theme';

/** How a little picture of a view is drawn: rows of shapes, each with its relative width. */
export interface ViewPicture {
  shape: 'square' | 'arch' | 'circle' | 'line';
  rows: readonly (readonly number[])[];
}

export interface ViewChoice<T extends string> {
  id: T;
  label: string;
  detail: string;
  picture: ViewPicture;
}

/** A tiny drawing of a layout, so each choice shows what it looks like, not just its name. */
function Picture({ picture, color }: { picture: ViewPicture; color: string }) {
  const { shape, rows } = picture;
  return (
    <View style={styles.picture}>
      {rows.map((row, rowIndex) => (
        <View
          key={rowIndex}
          style={[styles.pictureRow, shape === 'circle' ? styles.centred : null]}
        >
          {row.map((grow, index) => {
            if (shape === 'line') {
              // A file's line: its tile, then its name.
              return (
                <View key={index} style={styles.line}>
                  <View style={[styles.lineTile, { backgroundColor: color }]} />
                  <View style={[styles.lineText, { backgroundColor: color, opacity: 0.55 }]} />
                </View>
              );
            }
            // Every row the same height, so the whole picture fits its card uncropped.
            const height = (PICTURE - ROW_GAP * (rows.length - 1)) / rows.length;
            const cell: ViewStyle =
              shape === 'circle'
                ? { width: height, height, borderRadius: height / 2, backgroundColor: color }
                : {
                    flex: grow,
                    height,
                    backgroundColor: color,
                    borderRadius: 3,
                    ...(shape === 'arch'
                      ? { borderTopLeftRadius: height, borderTopRightRadius: height }
                      : {}),
                  };
            return <View key={index} style={cell} />;
          })}
        </View>
      ))}
    </View>
  );
}

/**
 * The View sheet of a tab: each way to lay it out as a card with a little picture of it, the
 * one in use ringed in the accent. Picking one closes the sheet.
 */
export function ViewSheet<T extends string>({
  choices,
  value,
  onPick,
  onCancel,
}: {
  choices: readonly ViewChoice<T>[];
  value: T;
  onPick: (id: T) => void;
  onCancel: () => void;
}) {
  const palette = usePalette();
  return (
    <Sheet title="View" onCancel={onCancel}>
      <View style={styles.cards} accessibilityRole="radiogroup">
        {choices.map((choice) => {
          const chosen = choice.id === value;
          return (
            <Pressable
              key={choice.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: chosen }}
              accessibilityLabel={`${choice.label}, ${choice.detail}`}
              onPress={() => {
                onPick(choice.id);
                onCancel();
              }}
              style={({ pressed }) => [
                styles.card,
                chosen
                  ? { borderColor: palette.accent, backgroundColor: palette.accentWash }
                  : { borderColor: palette.border, backgroundColor: palette.background },
                pressed ? { opacity: 0.8 } : null,
              ]}
            >
              <Picture picture={choice.picture} color={chosen ? palette.accent : palette.muted} />
              <Text style={[styles.label, { color: chosen ? palette.accent : palette.text }]}>
                {choice.label}
              </Text>
              <Text style={[styles.detail, { color: palette.muted }]} numberOfLines={2}>
                {choice.detail}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

/** The picture's height, and the gap between its rows. */
const PICTURE = 64;
const ROW_GAP = 3;

const styles = StyleSheet.create({
  cards: { flexDirection: 'row', gap: 10 },
  card: { flex: 1, borderWidth: 2, borderRadius: 20, padding: 12, gap: 4 },
  picture: { height: PICTURE, gap: ROW_GAP, overflow: 'hidden', marginBottom: 6 },
  pictureRow: { flexDirection: 'row', gap: ROW_GAP },
  centred: { justifyContent: 'center', gap: 6 },
  line: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, height: 14 },
  lineTile: { width: 12, height: 12, borderRadius: 3 },
  lineText: { flex: 1, height: 5, borderRadius: 3 },
  label: { fontSize: 15, fontWeight: '700' },
  detail: { fontSize: 12, lineHeight: 16 },
});
