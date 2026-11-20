import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { progressPercent } from '@arcafold/core/download/progress';

import { savingText } from '../library/save-text';
import type { SaveToPhone } from '../library/use-save-to-phone';
import { Button } from '../ui/kit';
import type { Palette } from '../ui/theme';

/**
 * How copies being saved to the phone are getting on, in the cards over the bottom of the
 * screen. Once they're all saved a notice says so, and the card goes.
 */
export function SaveCard({ saving, palette }: { saving: SaveToPhone; palette: Palette }) {
  const { job } = saving;
  if (!job) return null;
  return (
    <View
      style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.top}>
        <Text style={[styles.title, { color: palette.text }]}>{savingText(job.progress)}</Text>
        <ActivityIndicator color={palette.accent} />
        <Button kind="link" label="Stop" onPress={saving.cancel} />
      </View>
      <View style={[styles.track, { backgroundColor: palette.track }]}>
        <View
          style={[
            styles.bar,
            {
              width: `${String(progressPercent(job.progress))}%`,
              backgroundColor: palette.accent,
            },
          ]}
        />
      </View>
      <Text style={[styles.note, { color: palette.muted }]}>
        Keep Arcafold open and unlocked until they’re saved.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10, elevation: 6 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, fontSize: 15, fontWeight: '600' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
  note: { fontSize: 13 },
});
