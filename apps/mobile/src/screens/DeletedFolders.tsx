import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@arcafold/core/errors';
import { folderRestore } from '@arcafold/core/library/folders';
import type { Folder } from '@arcafold/core/library/model';
import { daysLeftLabel } from '@arcafold/core/library/trash';

import { folderSummary } from '../library/files';
import type { Library } from '../library/use-library';
import { useNotice } from '../ui/notice';
import { usePalette } from '../ui/theme';
import { HeaderButton } from './AppHeader';
import { FolderMark } from './FolderSheets';

/**
 * Folders in Recently deleted, each with what was deleted along with it. Restoring one brings
 * that back too, into the folder; deleting it for good (confirmed by the screen, `onDelete`)
 * deletes that too.
 */
export function DeletedFolders({
  library,
  folders,
  onDelete,
}: {
  library: Library;
  folders: readonly Folder[];
  onDelete: (folder: Folder) => void;
}) {
  const palette = usePalette();
  const notice = useNotice();
  const [busy, setBusy] = useState(false);
  const trash = library.trash ?? [];

  const restore = (folder: Folder) => {
    if (busy) return;
    setBusy(true);
    library.restoreFolder(folder.id).then(
      () => {
        setBusy(false);
        notice(`“${folder.name}” restored`);
      },
      (error: unknown) => {
        setBusy(false);
        notice(errorMessage(error));
      },
    );
  };

  return (
    <View style={styles.section}>
      <Text style={[styles.title, { color: palette.muted }]}>FOLDERS</Text>
      {folders.map((folder) => {
        const inside = folderRestore(library.folders, trash, folder.id);
        const meta = [
          folderSummary({ items: inside.itemIds.length, folders: inside.folderIds.length - 1 }),
          daysLeftLabel(folder),
        ].join(' · ');
        return (
          <View key={folder.id} style={[styles.row, { borderColor: palette.border }]}>
            <FolderMark palette={palette} size={20} />
            <View style={styles.text}>
              <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                {folder.name}
              </Text>
              <Text style={[styles.meta, { color: palette.muted }]} numberOfLines={1}>
                {meta}
              </Text>
            </View>
            <HeaderButton
              label="Restore"
              accessibilityLabel={`Restore ${folder.name}`}
              onPress={() => {
                restore(folder);
              }}
            />
            <HeaderButton
              label="Delete"
              accessibilityLabel={`Delete ${folder.name} for good`}
              danger
              onPress={() => {
                if (!busy) onDelete(folder);
              }}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, alignSelf: 'stretch' },
  title: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12.5 },
});
