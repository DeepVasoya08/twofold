import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { BackHandler } from 'react-native';

import { trashNote } from '@arcafold/core/library/trash';

import { batchText, deleteTitle } from '../library/trash-text';
import type { Library } from '../library/use-library';
import { useNotice } from '../ui/notice';
import { useSelection } from '../ui/selection';
import { HeaderButton, SelectionHeader } from './AppHeader';
import { ConfirmSheet } from './ConfirmSheet';

/**
 * Selecting photos on a grid and deleting them: a long press starts selecting, taps pick,
 * and the header turns into the selection's bar with Delete. Deleted photos go to Recently
 * deleted. Back stops selecting before it does anything else.
 */
export function usePickToDelete(
  library: Pick<Library, 'deletePhotos'>,
  open: (photoId: string) => void,
): {
  /** The header to show instead of the screen's own while selecting; null otherwise. */
  header: ReactElement | null;
  /** The sheet asking before deleting, while it's open. */
  sheet: ReactElement | null;
  /** What the grid takes. */
  grid: {
    onPress: (photoId: string) => void;
    onLongPress: (photoId: string) => void;
    chosen?: ReadonlySet<string>;
  };
} {
  const notice = useNotice();
  const selection = useSelection();
  const [confirming, setConfirming] = useState(false);
  const { selected, clear } = selection;

  useEffect(() => {
    if (!selected) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      clear();
      return true;
    });
    return () => {
      back.remove();
    };
  }, [selected, clear]);

  const picked = selected ? [...selected] : [];
  return {
    header: selected ? (
      <SelectionHeader count={picked.length} onCancel={clear}>
        {picked.length > 0 ? (
          <HeaderButton
            label="Delete"
            filled
            onPress={() => {
              setConfirming(true);
            }}
          />
        ) : null}
      </SelectionHeader>
    ) : null,
    sheet: confirming ? (
      <ConfirmSheet
        title={deleteTitle(picked.length)}
        body={trashNote(picked.length)}
        action="Delete"
        busyLabel="Deleting…"
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={async () => {
          const result = await library.deletePhotos(picked);
          setConfirming(false);
          notice(batchText(result, (photos) => `${photos} moved to Recently deleted`));
          if (result.failed.length > 0) selection.replace(result.failed);
          else clear();
        }}
      />
    ) : null,
    grid: {
      onPress: selected ? selection.toggle : open,
      onLongPress: selection.start,
      ...(selected ? { chosen: selected } : {}),
    },
  };
}
