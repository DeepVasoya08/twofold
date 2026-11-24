import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { timelineRows } from '../library/timeline';
import type { Library } from '../library/use-library';
import { useAccount } from '../session/account';
import { fonts } from '../theme';
import type { PhotoView } from '../library/layout';
import { useAppearance } from '../ui/appearance';
import { Icon } from '../ui/icons';
import { Button, Note } from '../ui/kit';
import { Sheet } from '../ui/sheet';
import { usePalette } from '../ui/theme';
import { AppHeader, HeaderIconButton } from './AppHeader';
import { PhotoGrid } from './PhotoGrid';
import { usePickToDelete } from './use-pick-to-delete';

const VIEWS: readonly { id: PhotoView; label: string; detail: string }[] = [
  { id: 'grid', label: 'Grid', detail: 'Square tiles, four across' },
  { id: 'compact', label: 'Compact', detail: 'Smaller squares, six across' },
  { id: 'uncropped', label: 'Uncropped', detail: 'Each photo in its own shape' },
];

/**
 * The open space's photos, newest first, by month: the Photos tab. The View button picks how
 * every photo grid is laid out; adding photos is the floating button (Home). A long press
 * starts selecting photos to delete.
 */
export function Timeline({
  library,
  initial,
  banner,
  onSettings,
  onAdd,
  onOpen,
  onSave,
  onTeach,
  onPicking,
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
  /** Teaches search a word from picked photos, while Smart search is on. */
  onTeach?: (photoIds: readonly string[]) => void;
  /**
   * Says when selecting or the View sheet starts and stops, so the floating Add button can
   * step aside.
   */
  onPicking?: (picking: boolean) => void;
}) {
  const { space } = useAccount();
  const palette = usePalette();
  const rows = useMemo(() => timelineRows(library.photos), [library.photos]);
  const picking = usePickToDelete(library, onOpen, { onSave, onTeach });
  const { photoView, setPhotoView } = useAppearance();
  const [choosingView, setChoosingView] = useState(false);
  const selecting = picking.header !== null;
  useEffect(() => {
    onPicking?.(selecting || choosingView);
  }, [selecting, choosingView, onPicking]);

  const header = picking.header ?? (
    <AppHeader
      title={space === 'private' ? 'Private' : 'Library'}
      initial={initial}
      onSettings={onSettings}
    >
      {library.status === 'ready' && rows.length > 0 ? (
        <HeaderIconButton
          icon={photoView}
          accessibilityLabel="View"
          onPress={() => {
            setChoosingView(true);
          }}
        />
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
      {choosingView ? (
        <Sheet
          title="View"
          onCancel={() => {
            setChoosingView(false);
          }}
        >
          {VIEWS.map((view) => {
            const chosen = view.id === photoView;
            return (
              <Pressable
                key={view.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: chosen }}
                onPress={() => {
                  setPhotoView(view.id);
                  setChoosingView(false);
                }}
                style={styles.viewRow}
              >
                <Icon name={view.id} size={22} color={chosen ? palette.accent : palette.text} />
                <View style={styles.viewText}>
                  <Text style={[styles.viewLabel, { color: palette.text }]}>{view.label}</Text>
                  <Text style={[styles.viewDetail, { color: palette.muted }]}>{view.detail}</Text>
                </View>
                {chosen ? <Icon name="check" size={20} color={palette.accent} /> : null}
              </Pressable>
            );
          })}
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 22, letterSpacing: -0.3 },
  viewRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  viewText: { flex: 1, gap: 2 },
  viewLabel: { fontSize: 16, fontWeight: '600' },
  viewDetail: { fontSize: 13 },
});
