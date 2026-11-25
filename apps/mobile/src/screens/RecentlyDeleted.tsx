import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, Text, View } from 'react-native';

import { inTrashedFolder, trashedFolders } from '@arcafold/core/library/folders';
import type { Folder } from '@arcafold/core/library/model';
import { TRASH_DAYS, daysLeftLabel } from '@arcafold/core/library/trash';

import { resultRows } from '../library/timeline';
import { batchText, deleteForeverTitle } from '../library/trash-text';
import type { Library } from '../library/use-library';
import { Note } from '../ui/kit';
import { useNotice } from '../ui/notice';
import { useSelection } from '../ui/selection';
import { usePalette } from '../ui/theme';
import { AppHeader, HeaderButton, SelectionHeader } from './AppHeader';
import { ConfirmSheet } from './ConfirmSheet';
import { DeletedFolders } from './DeletedFolders';
import { PhotoGrid } from './PhotoGrid';

/**
 * Photos deleted in the last 30 days, newest deletion first. Tap photos to pick them, then
 * restore them or delete them for good; after 30 days a device that opens the space deletes
 * them for good by itself.
 */
export function RecentlyDeleted({
  library,
  initial,
  onSettings,
  onClose,
}: {
  library: Library;
  initial: string;
  onSettings: () => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const notice = useNotice();
  const selection = useSelection();
  const [confirm, setConfirm] = useState<'selected' | 'all' | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [goingFolder, setGoingFolder] = useState<Folder | null>(null);
  const trash = library.trash;
  const allFolders = library.folders;
  // Items deleted along with a folder show under it, not on their own.
  const ids = useMemo(
    () => (trash ?? []).filter((item) => !inTrashedFolder(item, allFolders)).map((item) => item.id),
    [trash, allFolders],
  );
  const deletedFolders = useMemo(
    () => trashedFolders(allFolders).filter((folder) => !folder.viewOnly),
    [allFolders],
  );
  const nothing = ids.length === 0 && deletedFolders.length === 0;
  const rows = useMemo(() => resultRows(ids), [ids]);
  const picked = ids.filter((id) => selection.selected?.has(id));
  const soonest = trash?.at(-1);

  const { clear } = selection;
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selection.selected) clear();
      else onClose();
      return true;
    });
    return () => {
      back.remove();
    };
  }, [selection.selected, clear, onClose]);

  const restore = () => {
    if (restoring || picked.length === 0) return;
    setRestoring(true);
    library.restorePhotos(picked).then(
      (result) => {
        setRestoring(false);
        notice(batchText(result, (photos) => `${photos} restored`));
        if (result.failed.length > 0) selection.replace(result.failed);
        else clear();
      },
      () => {
        setRestoring(false);
        notice('The photos couldn’t be restored. Try again.');
      },
    );
  };

  const header = selection.selected ? (
    <SelectionHeader count={picked.length} onCancel={clear}>
      <HeaderButton
        label={picked.length === ids.length ? 'None' : 'All'}
        accessibilityLabel={picked.length === ids.length ? 'Select none' : 'Select all'}
        onPress={() => {
          selection.replace(picked.length === ids.length ? [] : ids);
        }}
      />
      {picked.length > 0 ? (
        <>
          <HeaderButton label={restoring ? 'Restoring…' : 'Restore'} onPress={restore} />
          <HeaderButton
            label="Delete"
            danger
            onPress={() => {
              setConfirm('selected');
            }}
          />
        </>
      ) : null}
    </SelectionHeader>
  ) : (
    <AppHeader title="Recently deleted" initial={initial} onBack={onClose} onSettings={onSettings}>
      {ids.length > 0 ? (
        <HeaderButton
          label="Select"
          onPress={() => {
            selection.replace([]);
          }}
        />
      ) : null}
    </AppHeader>
  );

  const about = (
    <View style={styles.about}>
      <Note>
        Photos stay here for {TRASH_DAYS} days, then they’re deleted for good. Tap Select to restore
        them or delete them now.
      </Note>
      {soonest ? (
        <Text style={[styles.meta, { color: palette.muted }]}>
          The oldest: {daysLeftLabel(soonest).toLowerCase()}.
        </Text>
      ) : null}
      {!nothing && !selection.selected ? (
        <HeaderButton
          label="Empty Recently deleted"
          onPress={() => {
            setConfirm('all');
          }}
        />
      ) : null}
      {deletedFolders.length > 0 ? (
        <DeletedFolders library={library} folders={deletedFolders} onDelete={setGoingFolder} />
      ) : null}
    </View>
  );

  const goingIds = confirm === 'all' ? ids : picked;
  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      {header}
      {trash === null ? (
        <View style={styles.centre}>
          <ActivityIndicator color={palette.accent} size="large" />
        </View>
      ) : nothing ? (
        <View style={styles.centre}>
          <Text style={[styles.emptyTitle, { color: palette.text }]}>Nothing here</Text>
          <Note>
            Photos you delete stay here for {TRASH_DAYS} days, so you can bring them back.
          </Note>
        </View>
      ) : (
        <PhotoGrid
          rows={rows}
          thumbs={library.thumbs}
          requestThumbs={library.requestThumbs}
          onPress={selection.toggle}
          onLongPress={selection.start}
          {...(selection.selected ? { chosen: selection.selected } : {})}
          header={about}
        />
      )}
      {confirm ? (
        <ConfirmSheet
          title={deleteForeverTitle(goingIds.length, confirm === 'all')}
          body="They’re deleted for good, from every device. This can’t be undone."
          action="Delete for good"
          busyLabel="Deleting…"
          onCancel={() => {
            setConfirm(null);
          }}
          onConfirm={async () => {
            const all = confirm === 'all';
            const result = goingIds.length > 0 ? await library.deleteForever(goingIds) : null;
            // Folders go after their loose files, each with what was deleted along with it.
            if (all)
              for (const folder of deletedFolders) await library.deleteFolderForever(folder.id);
            setConfirm(null);
            notice(
              result
                ? batchText(result, (photos) => `${photos} deleted for good`)
                : 'Recently deleted is empty',
            );
            if (result && result.failed.length > 0) selection.replace(result.failed);
            else clear();
          }}
        />
      ) : null}
      {goingFolder ? (
        <ConfirmSheet
          title={`Delete “${goingFolder.name}” for good?`}
          body="The folder and everything deleted along with it are deleted for good, from every device. This can’t be undone."
          action="Delete for good"
          busyLabel="Deleting…"
          onCancel={() => {
            setGoingFolder(null);
          }}
          onConfirm={async () => {
            await library.deleteFolderForever(goingFolder.id);
            notice(`“${goingFolder.name}” deleted for good`);
            setGoingFolder(null);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  centre: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700' },
  about: { paddingHorizontal: 16, paddingBottom: 12, gap: 8, alignItems: 'flex-start' },
  meta: { fontSize: 13 },
});
