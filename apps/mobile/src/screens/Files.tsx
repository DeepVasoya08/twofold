import { FlashList } from '@shopify/flash-list';
import type { ViewToken } from '@shopify/flash-list';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { categoryLabel } from '@arcafold/core/file-categories';
import {
  childFolders,
  folderCounts,
  folderTrash,
  folderTree,
  liveFolders,
} from '@arcafold/core/library/folders';
import type { Folder, Photo } from '@arcafold/core/library/model';
import { TRASH_DAYS } from '@arcafold/core/library/trash';

import { MemoryImage } from '../../modules/memory-image';
import {
  categoryCounts,
  fileBadge,
  fileDetails,
  fileGridRows,
  fileRows,
  filesHere,
  folderSummary,
  hasPreview,
  libraryFiles,
} from '../library/files';
import type { FileGridRow, FileRow, Shown } from '../library/files';
import { filterByName } from '../library/match';
import type { Library } from '../library/use-library';
import { useOpenFile } from '../library/use-open-file';
import { fonts } from '../theme';
import { useAppearance } from '../ui/appearance';
import { useReportPicking } from '../ui/float-space';
import { Button, Note } from '../ui/kit';
import { useNotice } from '../ui/notice';
import { usePalette } from '../ui/theme';
import type { Palette } from '../ui/theme';
import { FILE_CHOICES, FILE_COLUMNS } from '../ui/view-choices';
import { ViewSheet } from '../ui/view-sheet';
import { AppHeader } from './AppHeader';
import { ConfirmSheet } from './ConfirmSheet';
import { FolderActionsSheet, FolderCard, FolderNameSheet, MoveToFolderSheet } from './FolderSheets';
import { usePickToDelete } from './use-pick-to-delete';

const TILE = 48;
const GUTTER = 16;
const GAP = 10;

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

/** One file in the grid view: a big preview (or its kind) with its name under it. */
const FileTile = memo(function FileTile({
  item,
  imageId,
  size,
  chosen,
  opening,
  palette,
  requestThumbs,
  onPress,
  onLongPress,
}: {
  item: Photo;
  imageId: string | null;
  size: number;
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
      style={{ width: size }}
    >
      <View
        style={[
          styles.bigTile,
          {
            width: size,
            height: size * 1.2,
            backgroundColor: palette.surface,
            borderColor: chosen ? palette.accent : palette.border,
            borderWidth: chosen ? 2 : StyleSheet.hairlineWidth,
          },
        ]}
      >
        {preview ? (
          <MemoryImage imageId={imageId} style={{ width: size, height: size * 1.2 }} />
        ) : (
          <Text style={[styles.bigBadge, { color: palette.accent }]} numberOfLines={1}>
            {fileBadge(item)}
          </Text>
        )}
        {opening ? (
          <View style={styles.tileOver}>
            <ActivityIndicator color={palette.accent} />
          </View>
        ) : null}
        {choosing ? (
          <View
            style={[
              styles.tick,
              styles.tileTick,
              chosen
                ? { backgroundColor: palette.accent, borderColor: palette.accent }
                : { borderColor: '#ffffff', backgroundColor: 'rgba(0,0,0,0.25)' },
            ]}
          >
            {chosen ? <Text style={[styles.tickText, { color: palette.onAccent }]}>✓</Text> : null}
          </View>
        ) : null}
      </View>
      <Text style={[styles.tileName, { color: palette.text }]} numberOfLines={1}>
        {name}
      </Text>
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
 * categories as filters. The search field finds files by name as you type, and View shows
 * them as a list or a grid of previews. Tapping one opens it in another app, straight from
 * memory; a long press selects files to save to the phone or delete. Adding files is the
 * floating button (Home).
 */
export function Files({
  library,
  folderId,
  onFolder,
  initial,
  banner,
  onSettings,
  onAdd,
  onSave,
  onPicking,
}: {
  library: Library;
  /** The open folder, or null for the top of Files. */
  folderId: string | null;
  /** Opens a folder, or the top of Files for null. */
  onFolder: (folderId: string | null) => void;
  initial: string;
  banner: ReactNode;
  onSettings: () => void;
  onAdd: () => void;
  /** Saves copies to the phone (Download/Arcafold), where it can. */
  onSave?: (ids: readonly string[]) => void;
  /** Says when selecting or the View sheet starts and stops, so the floating buttons step aside. */
  onPicking?: (picking: boolean) => void;
}) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const { fileView, setFileView } = useAppearance();
  const [query, setQuery] = useState('');
  const [choosingView, setChoosingView] = useState(false);
  const tileSize = Math.floor((width - GUTTER * 2 - GAP * (FILE_COLUMNS - 1)) / FILE_COLUMNS);
  const notice = useNotice();
  const { opening, open } = useOpenFile(library, notice);
  const files = useMemo(() => libraryFiles(library.photos), [library.photos]);
  const counts = useMemo(() => categoryCounts(files), [files]);
  const [shown, setShown] = useState<Shown>('all');
  const { folders } = library;
  const live = useMemo(() => liveFolders(folders), [folders]);
  const here = folderId === null ? undefined : live.get(folderId);
  const at = here?.id ?? null;
  const [sheet, setSheet] = useState<FolderSheet>(null);
  // Categories cover every folder, so they're offered at the top of Files only. A category
  // whose files have all gone (deleted, say) falls back to everything.
  const showing: Shown =
    at === null && (shown === 'all' || counts.some(([category]) => category === shown))
      ? shown
      : 'all';
  // Searching or showing one category finds files in every folder.
  const everywhere = query.trim() !== '' || showing !== 'all';
  const subfolders = useMemo(
    () => (everywhere ? [] : childFolders(folders, at)),
    [everywhere, folders, at],
  );
  const found = useMemo(
    () =>
      filterByName(
        filesHere(files, folders, at, everywhere),
        query,
        (item) => item.file?.name ?? '',
      ),
    [files, folders, at, everywhere, query],
  );
  const rows = useMemo(() => fileRows(found, showing), [found, showing]);
  const gridRows = useMemo(
    () => (fileView === 'grid' ? fileGridRows(rows, FILE_COLUMNS) : null),
    [fileView, rows],
  );
  const byId = useMemo(() => new Map(files.map((item) => [item.id, item])), [files]);
  const openById = useCallback(
    (id: string) => {
      const item = byId.get(id);
      if (item) open(item);
    },
    [byId, open],
  );
  const picking = usePickToDelete(library, openById, {
    onSave,
    noun: 'file',
    onMove: (ids) => {
      setSheet({ kind: 'move-items', ids });
    },
  });

  // A folder that went (deleted on another device, say) leaves you at the top.
  useEffect(() => {
    if (folderId !== null && library.status === 'ready' && !here) onFolder(null);
  }, [folderId, here, library.status, onFolder]);

  // Back goes up a folder, once nothing else (selecting, a sheet) wants it.
  const up = useCallback(() => {
    onFolder(here?.parentId !== undefined && live.has(here.parentId) ? here.parentId : null);
  }, [here, live, onFolder]);
  useEffect(() => {
    if (!here) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      up();
      return true;
    });
    return () => {
      back.remove();
    };
  }, [here, up]);
  const { thumbs, requestThumbs } = library;
  const { chosen } = picking.grid;
  useReportPicking(picking.header !== null || choosingView, onPicking);

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
  const onGridViewable = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<FileGridRow>[] }) => {
      const onScreen = viewableItems.flatMap((token) =>
        token.item.kind === 'files'
          ? token.item.items.filter(hasPreview).map((item) => item.id)
          : [],
      );
      if (onScreen.length > 0) requestThumbs(onScreen, true);
    },
    [requestThumbs],
  );

  const monthHeading = useCallback(
    (row: { label: string; count: number }) => (
      <View style={styles.month}>
        <Text style={[styles.monthLabel, { color: palette.text }]} accessibilityRole="header">
          {row.label}
        </Text>
        <Text style={[styles.monthCount, { color: palette.muted }]}>
          {row.count === 1 ? '1 file' : `${String(row.count)} files`}
        </Text>
      </View>
    ),
    [palette],
  );

  const renderItem = useCallback(
    ({ item: row }: { item: FileRow }) =>
      row.kind === 'month' ? (
        monthHeading(row)
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
      monthHeading,
      picking.grid.onPress,
      picking.grid.onLongPress,
    ],
  );
  const renderGridRow = useCallback(
    ({ item: row }: { item: FileGridRow }) =>
      row.kind === 'month' ? (
        monthHeading(row)
      ) : (
        <View style={styles.gridRow}>
          {row.items.map((item) => (
            <FileTile
              key={item.id}
              item={item}
              imageId={thumbs.get(item.id) ?? null}
              size={tileSize}
              chosen={chosen ? chosen.has(item.id) : undefined}
              opening={opening === item.id}
              palette={palette}
              requestThumbs={requestThumbs}
              onPress={picking.grid.onPress}
              onLongPress={picking.grid.onLongPress}
            />
          ))}
        </View>
      ),
    [
      palette,
      thumbs,
      chosen,
      opening,
      tileSize,
      requestThumbs,
      monthHeading,
      picking.grid.onPress,
      picking.grid.onLongPress,
    ],
  );

  const header = picking.header ?? (
    <AppHeader
      title={here?.name ?? 'Files'}
      initial={initial}
      onSettings={onSettings}
      {...(here && { onBack: up })}
      search={{
        placeholder: here ? 'Search all files' : 'Search files',
        query,
        onQuery: setQuery,
        view: {
          icon: fileView === 'grid' ? 'grid' : 'files',
          label: 'View',
          onPress: () => {
            setChoosingView(true);
          },
        },
      }}
    />
  );
  const viewSheet = choosingView ? (
    <ViewSheet
      choices={FILE_CHOICES}
      value={fileView}
      onPick={setFileView}
      onCancel={() => {
        setChoosingView(false);
      }}
    />
  ) : null;

  const cardWidth = Math.floor((width - GUTTER * 2 - GAP) / 2);
  const sheets = (
    <FolderSheets
      library={library}
      sheet={sheet}
      at={at}
      notice={notice}
      onSheet={setSheet}
      onMoved={picking.clear}
      onLeft={(folder) => {
        if (folder.id === at) up();
      }}
    />
  );
  const top = (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={styles.chipBar}
      >
        {here?.viewOnly ? null : (
          <Chip
            label="+ New folder"
            selected={false}
            palette={palette}
            onPress={() => {
              setSheet({ kind: 'new' });
            }}
          />
        )}
        {at === null && counts.length > 1 ? (
          <>
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
          </>
        ) : null}
      </ScrollView>
      {subfolders.length > 0 ? (
        <View style={styles.folders}>
          {subfolders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              width={cardWidth}
              summary={folderSummary(folderCounts(folders, files, folder.id))}
              onOpen={onFolder}
              onMenu={
                folder.viewOnly
                  ? undefined
                  : (chosen) => {
                      setSheet({ kind: 'menu', folder: chosen });
                    }
              }
            />
          ))}
        </View>
      ) : null}
      {here && !everywhere && found.length === 0 && subfolders.length === 0 ? (
        <View style={styles.emptyFolder}>
          <Text style={[styles.emptyTitle, { color: palette.text }]}>This folder is empty</Text>
          <Note>
            {here.viewOnly
              ? 'Nothing has been put in this folder yet.'
              : 'Add files with the upload button, or select files and choose Move.'}
          </Note>
        </View>
      ) : null}
      {here && !everywhere && found.length > 0 && subfolders.length > 0 ? (
        <Text style={[styles.section, { color: palette.muted }]}>FILES</Text>
      ) : null}
    </View>
  );

  if (library.status !== 'ready' || (files.length === 0 && live.size === 0)) {
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
              <Button
                kind="secondary"
                label="New folder"
                onPress={() => {
                  setSheet({ kind: 'new' });
                }}
              />
            </>
          )}
        </View>
        {sheets}
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      {header}
      {banner}
      {rows.length === 0 && query.trim() !== '' ? (
        <View style={styles.centre}>
          <Note>No files called “{query.trim()}”.</Note>
        </View>
      ) : gridRows ? (
        <FlashList
          key="grid"
          data={gridRows}
          renderItem={renderGridRow}
          keyExtractor={(row) => row.key}
          getItemType={(row) => row.kind}
          extraData={[thumbs, chosen, opening]}
          onViewableItemsChanged={onGridViewable}
          ListHeaderComponent={top}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 24 + picking.floatSpace }}
        />
      ) : (
        <FlashList
          key="list"
          data={rows}
          renderItem={renderItem}
          keyExtractor={(row) => row.key}
          getItemType={(row) => row.kind}
          extraData={[thumbs, chosen, opening]}
          onViewableItemsChanged={onViewableItemsChanged}
          ListHeaderComponent={top}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 24 + picking.floatSpace }}
        />
      )}
      {picking.sheet}
      {viewSheet}
      {sheets}
    </View>
  );
}

/** Which folder sheet is open in Files. */
type FolderSheet =
  | { kind: 'new' }
  | { kind: 'menu'; folder: Folder }
  | { kind: 'rename'; folder: Folder }
  | { kind: 'delete'; folder: Folder }
  | { kind: 'move-folder'; folder: Folder }
  | { kind: 'move-items'; ids: readonly string[] }
  | null;

/** Making, renaming, moving and deleting folders, and moving files into them. */
function FolderSheets({
  library,
  sheet,
  at,
  notice,
  onSheet,
  onMoved,
  onLeft,
}: {
  library: Library;
  sheet: FolderSheet;
  /** The open folder, where new folders go. */
  at: string | null;
  notice: (message: string) => void;
  onSheet: (sheet: FolderSheet) => void;
  /** After files have moved, to stop selecting. */
  onMoved: () => void;
  /** After a folder has gone to Recently deleted. */
  onLeft: (folder: Folder) => void;
}) {
  const close = () => {
    onSheet(null);
  };
  if (!sheet) return null;
  const { folders } = library;
  const place = (folderId: string | null) =>
    folderId === null ? 'Files' : `“${liveFolders(folders).get(folderId)?.name ?? 'the folder'}”`;
  switch (sheet.kind) {
    case 'new':
      return (
        <FolderNameSheet
          title="New folder"
          action="Create"
          onSave={async (name) => {
            const folder = await library.createFolder(name, at ?? undefined);
            close();
            notice(`Made “${folder.name}”`);
          }}
          onCancel={close}
        />
      );
    case 'menu':
      return (
        <FolderActionsSheet
          folder={sheet.folder}
          onRename={() => {
            onSheet({ kind: 'rename', folder: sheet.folder });
          }}
          onMove={() => {
            onSheet({ kind: 'move-folder', folder: sheet.folder });
          }}
          onDelete={() => {
            onSheet({ kind: 'delete', folder: sheet.folder });
          }}
          onCancel={close}
        />
      );
    case 'rename':
      return (
        <FolderNameSheet
          title="Rename folder"
          action="Save"
          initial={sheet.folder.name}
          onSave={async (name) => {
            await library.renameFolder(sheet.folder.id, name);
            close();
          }}
          onCancel={close}
        />
      );
    case 'delete': {
      const { folderIds, itemIds } = folderTrash(folders, library.photos, sheet.folder.id);
      const inside = folderSummary({ folders: folderIds.length - 1, items: itemIds.length });
      return (
        <ConfirmSheet
          title={`Delete “${sheet.folder.name}”?`}
          body={
            inside === 'Empty'
              ? `The folder goes to Recently deleted for ${String(TRASH_DAYS)} days.`
              : `The folder and what’s in it (${inside}) go to Recently deleted for ${String(TRASH_DAYS)} days.`
          }
          action="Delete folder"
          busyLabel="Deleting…"
          onConfirm={async () => {
            await library.deleteFolder(sheet.folder.id);
            close();
            onLeft(sheet.folder);
            notice('Folder moved to Recently deleted');
          }}
          onCancel={close}
        />
      );
    }
    case 'move-folder':
      return (
        <MoveToFolderSheet
          title={`Move “${sheet.folder.name}” to…`}
          folders={folders.filter((folder) => folder.library === sheet.folder.library)}
          start={sheet.folder.parentId ?? null}
          blocked={folderTree(folders, sheet.folder.id)}
          onCreate={(name, parentId) => library.createFolder(name, parentId ?? undefined)}
          onMove={async (target) => {
            await library.moveFolder(sheet.folder.id, target);
            close();
            notice(`Moved to ${place(target)}`);
          }}
          onCancel={close}
        />
      );
    case 'move-items':
      return (
        <MoveToFolderSheet
          title={
            sheet.ids.length === 1
              ? 'Move 1 file to…'
              : `Move ${String(sheet.ids.length)} files to…`
          }
          folders={folders.filter((folder) => !folder.viewOnly)}
          start={at}
          onCreate={(name, parentId) => library.createFolder(name, parentId ?? undefined)}
          onMove={async (target) => {
            const result = await library.moveToFolder(sheet.ids, target);
            if (result.done.length === 0) throw result.error;
            close();
            onMoved();
            notice(
              result.failed.length > 0
                ? `Moved ${String(result.done.length)} to ${place(target)}. ${String(result.failed.length)} didn’t move.`
                : `Moved to ${place(target)}`,
            );
          }}
          onCancel={close}
        />
      );
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 22, letterSpacing: -0.3 },
  folders: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    paddingHorizontal: GUTTER,
    paddingBottom: 6,
  },
  emptyFolder: { padding: 24, gap: 10 },
  section: {
    paddingHorizontal: GUTTER,
    paddingTop: 16,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
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
  gridRow: { flexDirection: 'row', gap: GAP, paddingHorizontal: GUTTER, paddingBottom: 14 },
  bigTile: {
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigBadge: { fontSize: 15, fontWeight: '800' },
  tileOver: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileTick: { position: 'absolute', top: 8, right: 8 },
  tileName: { fontSize: 13, fontWeight: '600', marginTop: 6 },
});
