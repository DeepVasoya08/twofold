import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { BackHandler } from 'react-native';

import { trashNote } from '@arcafold/core/library/trash';

import { batchText, deleteTitle } from '../library/trash-text';
import type { Noun } from '../library/trash-text';
import { teachCountProblem } from '../search/smart-text';
import type { Library } from '../library/use-library';
import { useNotice } from '../ui/notice';
import { useSelection } from '../ui/selection';
import { HeaderButton, SelectionHeader } from './AppHeader';
import { ConfirmSheet } from './ConfirmSheet';

/**
 * Selecting photos on a grid and deleting them, saving them to the phone or teaching search
 * a word from them: a long press starts selecting, taps pick, and the header turns into the
 * selection's bar with Teach, Save and Delete. Deleted photos go to Recently deleted. Back
 * stops selecting before it does anything else.
 */
export function usePickToDelete(
  library: Pick<Library, 'deletePhotos'>,
  open: (photoId: string) => void,
  {
    onSave,
    onTeach,
    noun = 'photo',
  }: {
    /** Saves copies to the phone's gallery, where it can. */
    onSave?: ((photoIds: readonly string[]) => void) | undefined;
    /** Teaches search a word from the picked photos, while Smart search is on. */
    onTeach?: ((photoIds: readonly string[]) => void) | undefined;
    /** What's being picked, for the wording. */
    noun?: Noun;
  } = {},
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
        {picked.length > 0 && onTeach ? (
          <HeaderButton
            label="Teach"
            accessibilityLabel="Teach search a word"
            onPress={() => {
              onTeach(picked);
              // With the right number picked, the sheet takes over; otherwise it says how many.
              if (teachCountProblem(picked.length) === null) clear();
            }}
          />
        ) : null}
        {picked.length > 0 && onSave ? (
          <HeaderButton
            label="Save"
            onPress={() => {
              onSave(picked);
              clear();
            }}
          />
        ) : null}
        {picked.length > 0 ? (
          <HeaderButton
            label="Delete"
            danger
            onPress={() => {
              setConfirming(true);
            }}
          />
        ) : null}
      </SelectionHeader>
    ) : null,
    sheet: confirming ? (
      <ConfirmSheet
        title={deleteTitle(picked.length, noun)}
        body={trashNote(picked.length)}
        action="Delete"
        busyLabel="Deleting…"
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={async () => {
          const result = await library.deletePhotos(picked);
          setConfirming(false);
          notice(batchText(result, (done) => `${done} moved to Recently deleted`, noun));
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
