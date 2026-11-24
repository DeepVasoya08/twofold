import { useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { timelineRows } from '../library/timeline';
import type { Library } from '../library/use-library';
import { useAccount } from '../session/account';
import { fonts } from '../theme';
import { useAppearance } from '../ui/appearance';
import { useReportPicking } from '../ui/float-space';
import { Button, Note } from '../ui/kit';
import { usePalette } from '../ui/theme';
import { PHOTO_CHOICES } from '../ui/view-choices';
import { ViewSheet } from '../ui/view-sheet';
import { AppHeader, OpenSearch } from './AppHeader';
import { PhotoGrid } from './PhotoGrid';
import { usePickToDelete } from './use-pick-to-delete';

/**
 * The open space's photos, newest first, by month: the Photos tab. Under the title, the search
 * field opens search (which looks inside photos) and the View button beside it picks how every
 * photo grid is laid out; adding photos is the floating button (Home). A long press starts
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
   * Says when selecting or the View sheet starts and stops, so the floating tab bar and Add
   * button can step aside.
   */
  onPicking?: (picking: boolean) => void;
}) {
  const { space } = useAccount();
  const palette = usePalette();
  const rows = useMemo(() => timelineRows(library.photos), [library.photos]);
  const picking = usePickToDelete(library, onOpen, { onSave, onTeach });
  const { photoView, setPhotoView } = useAppearance();
  const [choosingView, setChoosingView] = useState(false);
  const openSearch = useContext(OpenSearch);
  const selecting = picking.header !== null;
  useReportPicking(selecting || choosingView, onPicking);

  const header = picking.header ?? (
    <AppHeader
      title={space === 'private' ? 'Private' : 'Library'}
      initial={initial}
      onSettings={onSettings}
      search={{
        placeholder: 'Search photos, places, people',
        ...(openSearch ? { onOpen: openSearch } : {}),
        ...(library.status === 'ready' && rows.length > 0
          ? {
              view: {
                icon: photoView,
                label: 'View',
                onPress: () => {
                  setChoosingView(true);
                },
              },
            }
          : {}),
      }}
    />
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
        <ViewSheet
          choices={PHOTO_CHOICES}
          value={photoView}
          onPick={setPhotoView}
          onCancel={() => {
            setChoosingView(false);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 22, letterSpacing: -0.3 },
});
