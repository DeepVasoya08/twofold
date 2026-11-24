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

import type { Group } from '@arcafold/core/people/grouping';
import { notLookedAtLine, notReadyLine } from '@arcafold/core/search/answer';
import type { Chip } from '@arcafold/core/search/query';
import type { SmartAlbum } from '@arcafold/core/search/smart-album';

import { resultRows } from '../library/timeline';
import type { Library } from '../library/use-library';
import { TRY_WORDS, namedPeople, searchStatus } from '../search/search-text';
import type { Find } from '../search/use-find';
import { Button, Note } from '../ui/kit';
import { fonts } from '../theme';
import { Icon } from '../ui/icons';
import type { IconName } from '../ui/icons';
import { PillButton } from '../ui/pill-button';
import { usePalette } from '../ui/theme';
import { FaceThumb } from './FaceThumb';
import { PhotoGrid } from './PhotoGrid';

/** Space between found photos, so each reads as its own result. */
const RESULT_GAP = 5;

/** Each kind of search part's icon. */
const CHIP_ICONS: Record<Chip['kind'], IconName> = {
  person: 'people',
  me: 'people',
  us: 'people',
  label: 'people',
  word: 'search',
  what: 'search',
  like: 'similar',
  when: 'clock',
};

/**
 * Searching your photos: a box at the top, what the search was read as (tap a part to leave
 * it out), and what it found. Nothing typed is kept once the screen closes.
 */
export function SearchScreen({
  find,
  library,
  onOpen,
  onClose,
  onSaveAlbum,
  groups = [],
  smartAlbums = [],
  onOpenSmart,
  wordsOn = false,
}: {
  find: Find;
  library: Library;
  onOpen: (photoId: string) => void;
  onClose: () => void;
  /** Saves the search on screen as a smart album, while Smart search is on here. */
  onSaveAlbum?: () => void;
  /** People found in the photos, offered before typing. */
  groups?: readonly Group[];
  /** Searches saved as albums, offered before typing. */
  smartAlbums?: readonly SmartAlbum[];
  onOpenSmart?: (id: string) => void;
  /** Whether searches can look inside photos here (Smart search on), to offer words to try. */
  wordsOn?: boolean;
}) {
  const palette = usePalette();
  const people = useMemo(() => namedPeople(groups), [groups]);
  const byId = useMemo(
    () => new Map(library.photos.map((photo) => [photo.id, photo])),
    [library.photos],
  );
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
              style={[styles.chip, { backgroundColor: palette.accentWash }]}
            >
              <View style={[styles.chipDot, { backgroundColor: palette.accent }]}>
                <Icon name={CHIP_ICONS[chip.kind]} size={13} color={palette.onAccent} />
              </View>
              <Text style={[styles.chipText, { color: palette.accent }]}>{chip.label}</Text>
              <Icon name="close" size={12} color={palette.accent} />
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
        <View style={styles.countRow}>
          <Text
            style={[styles.count, { color: palette.text }]}
            accessibilityLiveRegion="polite"
            accessibilityRole="header"
          >
            {best === 0 && more === 0
              ? 'No matches'
              : best > 0
                ? best === 1
                  ? '1 best match'
                  : `${best.toLocaleString('en-US')} best matches`
                : 'No clear matches'}
          </Text>
          {onSaveAlbum && query && query.chips.length > 0 && (best > 0 || more > 0) ? (
            <PillButton label="Save as album" icon="albums" onPress={onSaveAlbum} />
          ) : null}
        </View>
      ) : null}
      {found && best === 0 ? (
        <Note>
          {more === 0
            ? 'Try other words, or tap a part of the search to leave it out.'
            : 'These might be close:'}
        </Note>
      ) : null}
    </View>
  );

  const footer =
    found && (best > 0 || more > 0) ? (
      <View style={[styles.block, styles.footer]}>
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
          <Icon name="back" size={20} color={palette.text} />
        </Pressable>
        <View
          style={[styles.field, { borderColor: palette.accent, backgroundColor: palette.surface }]}
        >
          <Icon name="search" size={17} color={palette.muted} />
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
            style={[styles.input, { color: palette.text }]}
          />
          {find.text !== '' || query !== null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={10}
              onPress={find.clear}
              style={[styles.clear, { backgroundColor: palette.track }]}
            >
              <Icon name="close" size={11} color={palette.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {query === null ? (
        <ScrollView
          contentContainerStyle={styles.start}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {status ? <Note>{status}</Note> : null}
          {people.length > 0 ? (
            <View style={styles.section}>
              <Text style={[styles.heading, { color: palette.text }]} accessibilityRole="header">
                People
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.people}
                keyboardShouldPersistTaps="handled"
              >
                {people.map((group) => {
                  const face = group.faces[0];
                  return (
                    <Pressable
                      key={group.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Search for ${group.name}`}
                      onPress={() => {
                        find.searchFor(group.name);
                      }}
                      style={styles.person}
                    >
                      <FaceThumb
                        face={face}
                        photo={byId.get(face.photoId)}
                        imageId={library.thumbs.get(face.photoId) ?? null}
                        size={60}
                        requestThumbs={library.requestThumbs}
                      />
                      <Text style={[styles.personName, { color: palette.text }]} numberOfLines={1}>
                        {group.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
          {wordsOn ? (
            <View style={styles.section}>
              <Text style={[styles.heading, { color: palette.text }]} accessibilityRole="header">
                Try
              </Text>
              <View style={styles.tries}>
                {TRY_WORDS.map((word) => (
                  <Pressable
                    key={word}
                    accessibilityRole="button"
                    accessibilityLabel={`Search for ${word}`}
                    onPress={() => {
                      find.searchFor(word.toLowerCase());
                    }}
                    style={[
                      styles.try,
                      { backgroundColor: palette.surface, borderColor: palette.border },
                    ]}
                  >
                    <Icon name="search" size={14} color={palette.accent} />
                    <Text style={[styles.tryText, { color: palette.text }]}>{word}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {smartAlbums.length > 0 && onOpenSmart ? (
            <View style={styles.section}>
              <Text style={[styles.heading, { color: palette.text }]} accessibilityRole="header">
                Smart albums
              </Text>
              <View style={styles.tries}>
                {smartAlbums.map((smart) => (
                  <Pressable
                    key={smart.id}
                    accessibilityRole="button"
                    onPress={() => {
                      onOpenSmart(smart.id);
                    }}
                    style={[
                      styles.try,
                      { backgroundColor: palette.surface, borderColor: palette.border },
                    ]}
                  >
                    <Icon name="albums" size={14} color={palette.accent} />
                    <Text style={[styles.tryText, { color: palette.text }]}>{smart.title}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          <View style={[styles.private, { backgroundColor: palette.accentWash }]}>
            <Icon name="lock" size={18} color={palette.accent} />
            <Text style={[styles.privateText, { color: palette.text }]}>
              Try a person, a date, or what’s in the photo, like “Ada at the beach in June”. Search
              runs on this phone, and what you type is never sent or saved.
            </Text>
          </View>
        </ScrollView>
      ) : (
        <PhotoGrid
          rows={rows}
          thumbs={library.thumbs}
          requestThumbs={library.requestThumbs}
          onPress={onOpen}
          gap={RESULT_GAP}
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
  back: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  field: {
    flex: 1,
    height: 48,
    borderWidth: 2,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 0 },
  clear: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  start: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 40, gap: 24 },
  section: { gap: 12 },
  heading: { fontFamily: fonts.display, fontSize: 18, letterSpacing: -0.3 },
  people: { gap: 14 },
  person: { width: 64, alignItems: 'center', gap: 6 },
  personName: { fontSize: 13, fontWeight: '600' },
  tries: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  try: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tryText: { fontSize: 14, fontWeight: '600' },
  private: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: 18 },
  privateText: { flex: 1, fontSize: 13, lineHeight: 18 },
  headerBlock: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  chips: { gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    paddingLeft: 5,
    paddingRight: 11,
    paddingVertical: 5,
  },
  chipDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  block: { gap: 10, paddingHorizontal: 16 },
  footer: { paddingTop: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  meta: { fontSize: 14 },
  count: { flex: 1, fontFamily: fonts.display, fontSize: 20, letterSpacing: -0.3 },
});
