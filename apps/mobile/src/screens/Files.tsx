import { FlashList } from '@shopify/flash-list';
import type { ViewToken } from '@shopify/flash-list';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { categoryLabel } from '@arcafold/core/file-categories';
import type { Photo } from '@arcafold/core/library/model';

import { MemoryImage } from '../../modules/memory-image';
import {
  categoryCounts,
  fileBadge,
  fileDetails,
  fileRows,
  hasPreview,
  libraryFiles,
} from '../library/files';
import type { FileRow, Shown } from '../library/files';
import type { Library } from '../library/use-library';
import { useOpenFile } from '../library/use-open-file';
import { Button, Note } from '../ui/kit';
import { useNotice } from '../ui/notice';
import { usePalette } from '../ui/theme';
import type { Palette } from '../ui/theme';
import { AppHeader, HeaderButton } from './AppHeader';
import { usePickToDelete } from './use-pick-to-delete';

const TILE = 48;

/** One file: its preview (a PDF's first page) or its kind, name and details. */
const FileLine = memo(function FileLine({
  item,
  imageId,
  chosen,
  opening,
  palette,
  requestThumbs,
  onPress,
  onLongPress,
}: {
  item: Photo;
  imageId: string | null;
  /** Set while selecting: whether this one is picked. */
  chosen: boolean | undefined;
  opening: boolean;
  palette: Palette;
  requestThumbs: (ids: readonly string[]) => void;
  onPress: (id: string) => void;
  onLongPress: (id: string) => void;
}) {
  const preview = hasPreview(item);
  useEffect(() => {
    if (preview && !imageId) requestThumbs([item.id]);
  }, [preview, imageId, item.id, requestThumbs]);
  const choosing = chosen !== undefined;
  const name = item.file?.name ?? 'File';
  return (
    <Pressable
      accessibilityRole={choosing ? 'checkbox' : 'button'}
      accessibilityLabel={choosing ? name : `Open ${name}`}
      accessibilityState={choosing ? { checked: chosen } : { busy: opening }}
      onPress={() => {
        onPress(item.id);
      }}
      onLongPress={() => {
        onLongPress(item.id);
      }}
      style={[styles.line, chosen ? { backgroundColor: palette.surface } : null]}
    >
      <View
        style={[styles.tile, { backgroundColor: palette.surface, borderColor: palette.border }]}
      >
        {preview ? (
          <MemoryImage imageId={imageId} style={styles.tileImage} />
        ) : (
          <Text style={[styles.badge, { color: palette.accent }]} numberOfLines={1}>
            {fileBadge(item)}
          </Text>
        )}
      </View>
      <View style={styles.text}>
        <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.details, { color: palette.muted }]} numberOfLines={1}>
          {fileDetails(item)}
        </Text>
      </View>
      {opening ? <ActivityIndicator color={palette.accent} /> : null}
      {choosing ? (
        <View
          style={[
            styles.tick,
            chosen
              ? { backgroundColor: palette.accent, borderColor: palette.accent }
              : { borderColor: palette.border },
          ]}
        >
          {chosen ? <Text style={[styles.tickText, { color: palette.onAccent }]}>✓</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
});

function Chip({
  label,
  selected,
  palette,
  onPress,
}: {
  label: string;
  selected: boolean;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        selected
          ? { backgroundColor: palette.accent, borderColor: palette.accent }
          : { borderColor: palette.border },
      ]}
    >
      <Text style={[styles.chipText, { color: selected ? palette.onAccent : palette.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Files that aren't photos (PDFs, documents and so on) by month, newest first, with their
 * categories as filters. Tapping one opens it in another app, straight from memory; a long
 * press selects files to save to the phone or delete.
 */
export function Files({
  library,
  initial,
  banner,
  onSettings,
  onAdd,
  onSave,
}: {
  library: Library;
  initial: string;
  banner: ReactNode;
  onSettings: () => void;
  onAdd: () => void;
  /** Saves copies to the phone (Download/Arcafold), where it can. */
  onSave?: (ids: readonly string[]) => void;
}) {
  const palette = usePalette();
  const notice = useNotice();
  const { opening, open } = useOpenFile(library, notice);
  const files = useMemo(() => libraryFiles(library.photos), [library.photos]);
  const counts = useMemo(() => categoryCounts(files), [files]);
  const [shown, setShown] = useState<Shown>('all');
  // A category whose files have all gone (deleted, say) falls back to everything.
  const showing: Shown =
    shown === 'all' || counts.some(([category]) => category === shown) ? shown : 'all';
  const rows = useMemo(() => fileRows(files, showing), [files, showing]);
  const byId = useMemo(() => new Map(files.map((item) => [item.id, item])), [files]);
  const openById = useCallback(
    (id: string) => {
      const item = byId.get(id);
      if (item) open(item);
    },
    [byId, open],
  );
  const picking = usePickToDelete(library, openById, { onSave, noun: 'file' });
  const { thumbs, requestThumbs } = library;
  const { chosen } = picking.grid;

  // Previews on screen jump the queue ahead of those just drawn off screen.
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<FileRow>[] }) => {
      const onScreen = viewableItems.flatMap((token) =>
        token.item.kind === 'file' && hasPreview(token.item.item) ? [token.item.item.id] : [],
      );
      if (onScreen.length > 0) requestThumbs(onScreen, true);
    },
    [requestThumbs],
  );

  const renderItem = useCallback(
    ({ item: row }: { item: FileRow }) =>
      row.kind === 'month' ? (
        <View style={styles.month}>
          <Text style={[styles.monthLabel, { color: palette.text }]} accessibilityRole="header">
            {row.label}
          </Text>
          <Text style={[styles.monthCount, { color: palette.muted }]}>
            {row.count === 1 ? '1 file' : `${String(row.count)} files`}
          </Text>
        </View>
      ) : (
        <FileLine
          item={row.item}
          imageId={thumbs.get(row.item.id) ?? null}
          chosen={chosen ? chosen.has(row.item.id) : undefined}
          opening={opening === row.item.id}
          palette={palette}
          requestThumbs={requestThumbs}
          onPress={picking.grid.onPress}
          onLongPress={picking.grid.onLongPress}
        />
      ),
    [
      palette,
      thumbs,
      chosen,
      opening,
      requestThumbs,
      picking.grid.onPress,
      picking.grid.onLongPress,
    ],
  );

  const header = picking.header ?? (
    <AppHeader title="Files" initial={initial} onSettings={onSettings}>
      {library.status === 'ready' ? (
        <HeaderButton label="+ Add" accessibilityLabel="Add files" filled onPress={onAdd} />
      ) : null}
    </AppHeader>
  );

  if (library.status !== 'ready' || files.length === 0) {
    return (
      <View style={styles.fill}>
        {header}
        {banner}
        <View style={styles.centre}>
          {library.status === 'loading' ? (
            <>
              <ActivityIndicator color={palette.accent} size="large" />
              <Note>Opening your files…</Note>
            </>
          ) : library.status === 'failed' ? (
            <>
              <Note>Your files couldn’t be loaded. Check your connection and try again.</Note>
              <Button label="Try again" onPress={library.retry} />
            </>
          ) : (
            <>
              <Text style={[styles.emptyTitle, { color: palette.text }]}>No files yet</Text>
              <Note>
                Keep PDFs, documents and other files here, encrypted on this phone before they leave
                it.
              </Note>
              <Button label="Add files" onPress={onAdd} />
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
      {counts.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipBar}
        >
          <Chip
            label={`All ${String(files.length)}`}
            selected={showing === 'all'}
            palette={palette}
            onPress={() => {
              setShown('all');
            }}
          />
          {counts.map(([category, count]) => (
            <Chip
              key={category}
              label={`${categoryLabel(category)} ${String(count)}`}
              selected={showing === category}
              palette={palette}
              onPress={() => {
                setShown(category);
              }}
            />
          ))}
        </ScrollView>
      ) : null}
      <FlashList
        data={rows}
        renderItem={renderItem}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        extraData={[thumbs, chosen, opening]}
        onViewableItemsChanged={onViewableItemsChanged}
      />
      {picking.sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700' },
  chipBar: { flexGrow: 0 },
  chips: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  chipText: { fontSize: 14, fontWeight: '600' },
  month: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 6,
  },
  monthLabel: { fontSize: 17, fontWeight: '700' },
  monthCount: { fontSize: 13 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileImage: { width: TILE, height: TILE },
  badge: { fontSize: 12, fontWeight: '800' },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  details: { fontSize: 13 },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickText: { fontSize: 13, fontWeight: '800' },
});
