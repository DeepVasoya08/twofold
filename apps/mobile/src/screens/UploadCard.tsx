import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { summarizeUploads } from '@arcafold/core/upload/progress';

import { originalsText } from '../library/originals';
import { firstFailure, uploadHeadline } from '../library/upload-text';
import type { Library } from '../library/use-library';
import { Button } from '../ui/kit';
import type { Palette } from '../ui/theme';

/**
 * How the photos being added are getting on, in the cards over the bottom of the screen.
 * Once photos picked into the private space are all in, it offers to delete them from the
 * gallery.
 */
export function UploadCard({
  library,
  palette,
  onDeleteOriginals,
}: {
  library: Library;
  palette: Palette;
  onDeleteOriginals: () => void;
}) {
  const { items } = library.uploads;
  const summary = useMemo(() => summarizeUploads(items.map((item) => item.status)), [items]);
  if (items.length === 0) return null;
  const failure = firstFailure(items);
  const offer = summary.running === 0 && library.originals > 0;
  return (
    <View
      style={[styles.uploadCard, { backgroundColor: palette.surface, borderColor: palette.border }]}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.uploadTop}>
        <Text style={[styles.uploadTitle, { color: palette.text }]}>{uploadHeadline(summary)}</Text>
        {summary.running > 0 ? (
          <ActivityIndicator color={palette.accent} />
        ) : offer ? null : (
          <Button kind="link" label="Done" onPress={library.hideUploads} />
        )}
      </View>
      <View style={[styles.uploadTrack, { backgroundColor: palette.track }]}>
        <View
          style={[
            styles.uploadBar,
            {
              width: `${String(summary.percent)}%`,
              backgroundColor: summary.failed > 0 ? palette.warning : palette.accent,
            },
          ]}
        />
      </View>
      {summary.running > 0 ? (
        <Text style={[styles.uploadNote, { color: palette.muted }]}>
          You can leave Arcafold: they keep going, and a notification says when they’re in.
        </Text>
      ) : null}
      {failure ? (
        <Text style={[styles.uploadNote, { color: palette.error }]}>{failure}</Text>
      ) : null}
      {offer ? (
        <>
          <Text style={[styles.uploadNote, { color: palette.text }]}>
            {originalsText(library.originals)}
          </Text>
          <Button label="Delete from gallery" onPress={onDeleteOriginals} />
          <Button
            kind="link"
            label="Keep them there"
            onPress={() => {
              library.keepOriginals();
              library.hideUploads();
            }}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  uploadCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
    elevation: 6,
  },
  uploadTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  uploadTitle: { flex: 1, fontSize: 15, fontWeight: '600' },
  uploadTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  uploadBar: { height: 6, borderRadius: 3 },
  uploadNote: { fontSize: 13 },
});
