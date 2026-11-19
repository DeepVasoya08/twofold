import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';

import { fitsAlbum } from '@arcafold/core/library/albums';
import type { Album } from '@arcafold/core/library/model';

import { albumChangeText, chosenText } from '../library/album-text';
import { timelinePhotos, timelineRows } from '../library/timeline';
import type { Library } from '../library/use-library';
import { Banner, Note } from '../ui/kit';
import { useNotice } from '../ui/notice';
import { usePalette } from '../ui/theme';
import { PhotoGrid } from './PhotoGrid';

/**
 * Your library's photos to tick, to put the ticked ones in an album. Photos already in it,
 * and ones that can't go in it (another library's), aren't shown.
 */
export function ChoosePhotos({
  album,
  library,
  onClose,
}: {
  album: Album;
  library: Library;
  onClose: () => void;
}) {
  const palette = usePalette();
  const notice = useNotice();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = useMemo(
    () =>
      timelinePhotos(library.photos).filter(
        (photo) => fitsAlbum(photo, album) && !photo.albumIds.includes(album.id),
      ),
    [library.photos, album],
  );
  const rows = useMemo(() => timelineRows(candidates), [candidates]);

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!busy) onClose();
      return true;
    });
    return () => {
      back.remove();
    };
  }, [busy, onClose]);

  const toggle = useCallback((photoId: string) => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }, []);

  const add = () => {
    if (busy || chosen.size === 0) return;
    setBusy(true);
    setError(null);
    library.setInAlbum([...chosen], album, true).then(
      (result) => {
        setBusy(false);
        if (result.done.length === 0) {
          setError(albumChangeText(result, album.title, true));
          return;
        }
        notice(albumChangeText(result, album.title, true));
        onClose();
      },
      () => {
        setBusy(false);
        setError('The photos couldn’t be added. Try again.');
      },
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={[styles.bar, { paddingTop: (StatusBar.currentHeight ?? 24) + 12 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={busy ? undefined : onClose}
          hitSlop={12}
          style={styles.close}
        >
          <Text style={[styles.closeText, { color: palette.text }]}>✕</Text>
        </Pressable>
        <View style={styles.titles}>
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
            {chosenText(chosen.size)}
          </Text>
          <Text style={[styles.subtitle, { color: palette.muted }]} numberOfLines={1}>
            For “{album.title}”
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: chosen.size === 0 || busy, busy }}
          disabled={chosen.size === 0 || busy}
          onPress={add}
          style={[
            styles.add,
            { backgroundColor: palette.accent, opacity: chosen.size === 0 || busy ? 0.5 : 1 },
          ]}
        >
          <Text style={[styles.addText, { color: palette.onAccent }]}>
            {busy ? 'Adding…' : 'Add'}
          </Text>
        </Pressable>
      </View>
      {error ? (
        <View style={styles.banner}>
          <Banner>{error}</Banner>
        </View>
      ) : null}
      {rows.length === 0 ? (
        <View style={styles.centre}>
          <Note>Every photo in your library is already in this album.</Note>
        </View>
      ) : (
        <PhotoGrid
          rows={rows}
          thumbs={library.thumbs}
          requestThumbs={library.requestThumbs}
          onPress={toggle}
          chosen={chosen}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 22 },
  titles: { flex: 1 },
  title: { fontSize: 18, fontWeight: '700' },
  subtitle: { fontSize: 13, marginTop: 1 },
  add: { borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 },
  addText: { fontSize: 15, fontWeight: '700' },
  banner: { paddingHorizontal: 16, paddingBottom: 8 },
  centre: { flex: 1, justifyContent: 'center', padding: 24 },
});
