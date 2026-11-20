import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { timelineRows } from '../library/timeline';
import type { Library } from '../library/use-library';
import { useAccount } from '../session/account';
import { Button, Note } from '../ui/kit';
import { usePalette } from '../ui/theme';
import { AppHeader, HeaderButton } from './AppHeader';
import { PhotoGrid } from './PhotoGrid';
import { usePickToDelete } from './use-pick-to-delete';

/**
 * The open space's photos, newest first, by month: the Photos tab. A long press starts
 * selecting photos to delete.
 */
export function Timeline({
  library,
  initial,
  banner,
  onSettings,
  onAdd,
  onOpen,
  onSave,
}: {
  library: Library;
  initial: string;
  /** A problem to show under the header (the picker didn't open, say). */
  banner: ReactNode;
  onSettings: () => void;
  onAdd: () => void;
  onOpen: (photoId: string) => void;
  /** Saves copies of photos to the phone's gallery, where it can. */
  onSave?: (photoIds: readonly string[]) => void;
}) {
  const { space } = useAccount();
  const palette = usePalette();
  const rows = useMemo(() => timelineRows(library.photos), [library.photos]);
  const picking = usePickToDelete(library, onOpen, onSave);

  const header = picking.header ?? (
    <AppHeader
      title={space === 'private' ? 'Private space' : 'Library'}
      initial={initial}
      onSettings={onSettings}
    >
      {library.status === 'ready' ? (
        <HeaderButton label="+ Add" accessibilityLabel="Add photos" filled onPress={onAdd} />
      ) : null}
    </AppHeader>
  );

  if (library.status !== 'ready' || rows.length === 0) {
    return (
      <View style={styles.fill}>
        {header}
        {banner}
        <View style={styles.centre}>
          {library.status === 'loading' ? (
            <>
              <ActivityIndicator color={palette.accent} size="large" />
              <Note>Opening your photos…</Note>
            </>
          ) : library.status === 'failed' ? (
            <>
              <Note>Your photos couldn’t be loaded. Check your connection and try again.</Note>
              <Button label="Try again" onPress={library.retry} />
            </>
          ) : (
            <>
              <Text style={[styles.emptyTitle, { color: palette.text }]}>No photos yet</Text>
              <Note>
                Add photos from this phone, or at arcafold.com. They’re encrypted before they leave
                the device.
              </Note>
              <Button label="Add photos" onPress={onAdd} />
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      {header}
      {banner}
      <PhotoGrid
        rows={rows}
        thumbs={library.thumbs}
        requestThumbs={library.requestThumbs}
        {...picking.grid}
      />
      {picking.sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700' },
});
