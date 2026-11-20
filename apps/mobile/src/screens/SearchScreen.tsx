import { useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { notLookedAtLine, notReadyLine } from '@arcafold/core/search/answer';

import { resultRows } from '../library/timeline';
import type { Library } from '../library/use-library';
import { searchStatus } from '../search/search-text';
import type { Find } from '../search/use-find';
import { Button, Note } from '../ui/kit';
import { usePalette } from '../ui/theme';
import { PhotoGrid } from './PhotoGrid';

/**
 * Searching your photos: a box at the top, what the search was read as (tap a part to leave
 * it out), and what it found. Nothing typed is kept once the screen closes.
 */
export function SearchScreen({
  find,
  library,
  onOpen,
  onClose,
}: {
  find: Find;
  library: Library;
  onOpen: (photoId: string) => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => {
      back.remove();
    };
  }, [onClose]);

  const { query, found, words } = find;
  const rows = useMemo(() => resultRows(find.shownIds), [find.shownIds]);
  const hasWords = (query?.what ?? '') !== '';
  const looksAlike = query !== null && (query.like !== null || query.taught.length > 0);
  const notIndexed = find.lookedAt.total - find.lookedAt.done;
  const best = found?.best.length ?? 0;
  const more = found?.more.length ?? 0;
  const status = searchStatus(find);

  const header = (
    <View style={styles.headerBlock}>
      {query && query.chips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {query.chips.map((chip) => (
            <Pressable
              key={chip.key}
              accessibilityRole="button"
              accessibilityLabel={`Stop looking for ${chip.label}`}
              onPress={() => {
                find.toggleChip(chip.key);
              }}
              style={[
                styles.chip,
                { borderColor: palette.border, backgroundColor: palette.surface },
              ]}
            >
              <Text style={[styles.chipText, { color: palette.text }]}>{chip.label} ✕</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {query?.needsMe ? (
        <Note>To search for yourself, open your photos in People and choose “This is me”.</Note>
      ) : null}
      {status ? <Note>{status}</Note> : null}
      {words.state === 'ask' ? (
        <View style={styles.block}>
          <Note>
            To find photos by what’s in them, this phone downloads some resources the first time
            (about 65 MB). Wi-Fi is best. Your search stays on this phone.
          </Note>
          <Button label="Download and search" onPress={find.allowDownload} />
        </View>
      ) : null}
      {words.state === 'downloading' ? (
        <View style={styles.row}>
          <ActivityIndicator color={palette.accent} />
          <Text style={[styles.meta, { color: palette.muted }]}>
            Downloading resources for search (
            {String(Math.floor((words.received / Math.max(1, words.total)) * 100))}%)
          </Text>
        </View>
      ) : null}
      {words.state === 'working' ? (
        <View style={styles.row}>
          <ActivityIndicator color={palette.accent} />
          <Text style={[styles.meta, { color: palette.muted }]}>Searching…</Text>
        </View>
      ) : null}
      {words.state === 'failed' ? (
        <View style={styles.block}>
          <Note error>{words.message}</Note>
          <Button kind="secondary" label="Try again" onPress={find.retry} />
        </View>
      ) : null}
      {find.notLookedAt.photo || find.notLookedAt.words.length > 0 ? (
        <Note>{notLookedAtLine(find.notLookedAt)}</Note>
      ) : null}
      {found ? (
        <Text style={[styles.count, { color: palette.text }]} accessibilityLiveRegion="polite">
          {best === 0 && more === 0
            ? 'No matches. Try other words, or tap a part of the search to leave it out.'
            : best > 0
              ? best === 1
                ? '1 best match'
                : `${best.toLocaleString('en-US')} best matches`
              : 'No clear matches. These might be close:'}
        </Text>
      ) : null}
    </View>
  );

  const footer =
    found && (best > 0 || more > 0) ? (
      <View style={styles.block}>
        {best > 0 && more > 0 && !find.showMore ? (
          <Button
            kind="secondary"
            label={`Show ${more.toLocaleString('en-US')} more`}
            onPress={() => {
              find.setShowMore(true);
            }}
          />
        ) : null}
        {(hasWords || looksAlike) && Math.max(found.notReady, notIndexed) > 0 ? (
          <Note>{notReadyLine(Math.max(found.notReady, notIndexed))}</Note>
        ) : null}
      </View>
    ) : undefined;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={[styles.bar, { paddingTop: (StatusBar.currentHeight ?? 24) + 10 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close search"
          onPress={onClose}
          hitSlop={10}
          style={styles.back}
        >
          <Text style={[styles.backText, { color: palette.text }]}>‹</Text>
        </Pressable>
        <TextInput
          accessibilityLabel="Search your photos"
          placeholder="Search: people, places, dates…"
          placeholderTextColor={palette.muted}
          value={find.text}
          onChangeText={find.setText}
          onSubmitEditing={find.submit}
          returnKeyType="search"
          autoFocus
          autoCorrect={false}
          // Searches are never learned by the keyboard.
          autoComplete="off"
          importantForAutofill="no"
          keyboardType="visible-password"
          maxLength={300}
          style={[
            styles.input,
            { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface },
          ]}
        />
      </View>
      {query === null ? (
        <View style={styles.empty}>
          <Note>
            Try a person, a date, or what’s in the photo, like “Ada at the beach in June”. Searches
            run on this phone and aren’t saved.
          </Note>
          {status ? <Note>{status}</Note> : null}
        </View>
      ) : (
        <PhotoGrid
          rows={rows}
          thumbs={library.thumbs}
          requestThumbs={library.requestThumbs}
          onPress={onOpen}
          header={header}
          {...(footer ? { footer } : {})}
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
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  back: { width: 28, height: 34, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 34, lineHeight: 36, fontWeight: '300' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
  },
  empty: { padding: 24, gap: 12 },
  headerBlock: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  chips: { gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 14, fontWeight: '600' },
  block: { gap: 10, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  meta: { fontSize: 14 },
  count: { fontSize: 15, fontWeight: '600' },
});
