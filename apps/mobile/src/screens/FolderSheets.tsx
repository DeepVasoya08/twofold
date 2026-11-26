import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@arcafold/core/errors';
import { childFolders, folderName, folderPath } from '@arcafold/core/library/folders';
import type { Folder } from '@arcafold/core/library/model';
import { MAX_FOLDER_NAME } from '@arcafold/core/records';

import { Banner, Button } from '../ui/kit';
import { Sheet, SheetOption } from '../ui/sheet';
import { usePalette } from '../ui/theme';
import type { Palette } from '../ui/theme';
import { NameSheet } from './AlbumSheets';

/** A folder name as NameSheet checks it: trimmed, there, and not too long. */
export function checkFolderName(name: string): { title: string } | { error: string } {
  try {
    return { title: folderName(name) };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

/** Names a new folder, or renames one. */
export function FolderNameSheet({
  title,
  action,
  initial,
  onSave,
  onCancel,
}: {
  title: string;
  action: string;
  initial?: string;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <NameSheet
      title={title}
      action={action}
      label="Folder name"
      placeholder="Taxes 2025"
      maxLength={MAX_FOLDER_NAME}
      check={checkFolderName}
      onSave={onSave}
      onCancel={onCancel}
      {...(initial !== undefined && { initial })}
    />
  );
}

/** A folder's menu: rename, share (your own), move or delete it. */
export function FolderActionsSheet({
  folder,
  onRename,
  onShare,
  onMove,
  onDelete,
  onCancel,
}: {
  folder: Folder;
  onRename: () => void;
  /** Left out for a folder that isn't yours to share. */
  onShare?: () => void;
  onMove: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet title={folder.name} onCancel={onCancel}>
      <SheetOption label="Rename" onPress={onRename} />
      {onShare ? (
        <SheetOption
          label="Share"
          detail="Invite someone to view or edit this folder"
          onPress={onShare}
        />
      ) : null}
      <SheetOption label="Move to folder" onPress={onMove} />
      <SheetOption label="Delete folder" danger onPress={onDelete} />
    </Sheet>
  );
}

/**
 * Picks where to move files or a folder: the top of Files or any folder, opened one level at
 * a time, with a way to make a new folder where you are. `blocked` folders (one being moved,
 * and those inside it) can't be opened.
 */
export function MoveToFolderSheet({
  title,
  folders,
  start,
  blocked = new Set(),
  onMove,
  onCreate,
  onCancel,
}: {
  title: string;
  folders: readonly Folder[];
  start: string | null;
  blocked?: ReadonlySet<string>;
  onMove: (folderId: string | null) => Promise<void>;
  onCreate: (name: string, parentId: string | null) => Promise<Folder>;
  onCancel: () => void;
}) {
  const palette = usePalette();
  const [at, setAt] = useState<string | null>(start !== null && blocked.has(start) ? null : start);
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = at === null ? [] : folderPath(folders, at);
  const here = path.at(-1) ?? null;
  const children = childFolders(folders, here?.id ?? null).filter(
    (folder) => !blocked.has(folder.id),
  );

  if (naming) {
    return (
      <FolderNameSheet
        title={here ? `New folder in “${here.name}”` : 'New folder'}
        action="Create"
        onSave={async (name) => {
          const made = await onCreate(name, here?.id ?? null);
          setNaming(false);
          setAt(made.id);
        }}
        onCancel={() => {
          setNaming(false);
        }}
      />
    );
  }

  const move = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    onMove(here?.id ?? null).then(
      () => {
        setBusy(false);
      },
      (caught: unknown) => {
        setBusy(false);
        setError(errorMessage(caught));
      },
    );
  };

  return (
    <Sheet title={title} busy={busy} onCancel={onCancel}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.path}>
          <Crumb
            label="Files"
            current={here === null}
            palette={palette}
            onPress={() => {
              setAt(null);
            }}
          />
          {path.map((folder) => (
            <View key={folder.id} style={styles.step}>
              <Text style={{ color: palette.muted }}>›</Text>
              <Crumb
                label={folder.name}
                current={folder.id === here?.id}
                palette={palette}
                onPress={() => {
                  setAt(folder.id);
                }}
              />
            </View>
          ))}
        </View>
      </ScrollView>
      <ScrollView style={styles.list}>
        {children.length === 0 ? (
          <Text style={[styles.empty, { color: palette.muted }]}>No folders in here yet.</Text>
        ) : (
          children.map((folder) => (
            <Pressable
              key={folder.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${folder.name}`}
              onPress={() => {
                setAt(folder.id);
              }}
              style={({ pressed }) => [
                styles.row,
                pressed ? { backgroundColor: palette.track } : null,
              ]}
            >
              <FolderMark palette={palette} size={20} />
              <Text style={[styles.rowName, { color: palette.text }]} numberOfLines={1}>
                {folder.name}
              </Text>
              <Text style={[styles.chevron, { color: palette.muted }]}>›</Text>
            </Pressable>
          ))
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setNaming(true);
          }}
          style={styles.row}
        >
          <Text style={[styles.rowName, { color: palette.accent }]}>+ New folder</Text>
        </Pressable>
      </ScrollView>
      {error ? <Banner>{error}</Banner> : null}
      <Button
        label={here ? `Move to “${here.name}”` : 'Move to Files'}
        busyLabel="Moving…"
        busy={busy}
        onPress={move}
      />
      <Button kind="link" label="Cancel" onPress={busy ? () => undefined : onCancel} />
    </Sheet>
  );
}

function Crumb({
  label,
  current,
  palette,
  onPress,
}: {
  label: string;
  current: boolean;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={6}>
      <Text
        style={[
          styles.crumb,
          { color: current ? palette.text : palette.muted, fontWeight: current ? '700' : '500' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** The small folder outline used in lists: a tab behind, the folder's front over it. */
export function FolderMark({ palette, size }: { palette: Palette; size: number }) {
  const line = {
    borderWidth: 1.5,
    borderColor: palette.accent,
    backgroundColor: palette.accentWash,
  };
  return (
    <View style={{ width: size * 1.2, height: size }}>
      <View
        style={[
          line,
          {
            position: 'absolute',
            top: 0,
            left: 0,
            width: size * 0.5,
            height: size * 0.4,
            borderBottomWidth: 0,
            borderTopLeftRadius: 3,
            borderTopRightRadius: 3,
          },
        ]}
      />
      <View
        style={[
          line,
          {
            position: 'absolute',
            top: size * 0.18,
            right: 0,
            bottom: 0,
            left: 0,
            borderRadius: 4,
            borderTopLeftRadius: 1,
          },
        ]}
      />
    </View>
  );
}

/**
 * A folder as a card in Files: a folder shape on top, its name and what's in it. A tap opens it; a
 * long press opens its menu.
 */
export function FolderCard({
  folder,
  summary,
  width,
  onOpen,
  onMenu,
}: {
  folder: Folder;
  summary: string;
  width: number;
  onOpen: (folderId: string) => void;
  onMenu?: ((folder: Folder) => void) | undefined;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open folder ${folder.name}`}
      accessibilityHint={onMenu ? 'Long press for rename, move and delete' : undefined}
      onPress={() => {
        onOpen(folder.id);
      }}
      onLongPress={
        onMenu
          ? () => {
              onMenu(folder);
            }
          : undefined
      }
      style={({ pressed }) => [
        styles.card,
        {
          width,
          backgroundColor: palette.surface,
          borderColor: palette.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.shape}>
        <View style={[styles.tab, { backgroundColor: palette.accentSoft }]} />
        <View
          style={[
            styles.front,
            { backgroundColor: palette.accentWash, borderTopColor: palette.accentSoft },
          ]}
        />
      </View>
      <Text style={[styles.cardName, { color: palette.text }]} numberOfLines={1}>
        {folder.name}
      </Text>
      <Text style={[styles.cardMeta, { color: palette.muted }]} numberOfLines={1}>
        {folder.library === undefined ? summary : `${summary} · ${folder.library}’s`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  path: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 4 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  crumb: { fontSize: 15 },
  list: { maxHeight: 280 },
  empty: { paddingVertical: 12, fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 12,
  },
  rowName: { flex: 1, fontSize: 16, fontWeight: '600' },
  chevron: { fontSize: 22 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    gap: 2,
  },
  shape: { height: 40, marginBottom: 8 },
  tab: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '42%',
    height: 14,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    opacity: 0.45,
  },
  front: {
    position: 'absolute',
    top: 7,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 12,
    borderTopLeftRadius: 3,
    borderTopWidth: 2,
  },
  cardName: { fontSize: 15, fontWeight: '700' },
  cardMeta: { fontSize: 12.5 },
});
