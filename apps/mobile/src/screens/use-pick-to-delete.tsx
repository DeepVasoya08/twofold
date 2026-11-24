import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { BackHandler } from 'react-native';

import type { Album, Photo } from '@arcafold/core/library/model';
import { trashNote } from '@arcafold/core/library/trash';

import { albumChangeText } from '../library/album-text';
import { batchText, deleteTitle } from '../library/trash-text';
import type { Noun } from '../library/trash-text';
import { teachCountProblem } from '../search/smart-text';
import type { Library } from '../library/use-library';
import { ActionBar, actionBarSpace } from '../ui/action-bar';
import type { BarAction } from '../ui/action-bar';
import { useFloatSpace } from '../ui/float-space';
import { useNotice } from '../ui/notice';
import { useSelection } from '../ui/selection';
import { NameSheet, PickAlbumSheet } from './AlbumSheets';
import { HeaderButton, SelectionHeader } from './AppHeader';
import { ConfirmSheet } from './ConfirmSheet';

/** What the selection can put in albums with, where it can. */
export type Filing = Pick<Library, 'photos' | 'albums' | 'setInAlbum' | 'createAlbum'>;

type Open = 'delete' | 'album' | 'naming' | null;

/**
 * Selecting photos on a grid and acting on them together: a long press starts selecting,
 * taps pick, the header turns into "N selected" with Select all, and a floating bar takes the
 * tab bar's place with Album, Save, Teach and Delete. Deleted photos go to Recently deleted.
 * Back stops selecting before it does anything else.
 */
export function usePickToDelete(
  library: Pick<Library, 'deletePhotos'>,
  open: (photoId: string) => void,
  {
    onSave,
    onTeach,
    filing,
    all,
    noun = 'photo',
  }: {
    /** Saves copies to the phone's gallery, where it can. */
    onSave?: ((photoIds: readonly string[]) => void) | undefined;
    /** Teaches search a word from the picked photos, while Smart search is on. */
    onTeach?: ((photoIds: readonly string[]) => void) | undefined;
    /** Puts the picked photos in an album; left out where that doesn't apply (files). */
    filing?: Filing | undefined;
    /** Every photo on the screen, in order, for Select all. */
    all?: readonly string[] | undefined;
    /** What's being picked, for the wording. */
    noun?: Noun;
  } = {},
): {
  /** The header to show instead of the screen's own while selecting; null otherwise. */
  header: ReactElement | null;
  /** The floating bar of actions and any sheet they open, while selecting. */
  sheet: ReactElement | null;
  /** How much room the screen's list leaves at its end, so the bar doesn't cover it. */
  floatSpace: number;
  /** What the grid takes. */
  grid: {
    onPress: (photoId: string) => void;
    onLongPress: (photoId: string) => void;
    chosen?: ReadonlySet<string>;
    floatSpace: number;
  };
} {
  const notice = useNotice();
  const selection = useSelection();
  const outerSpace = useFloatSpace();
  const [opened, setOpened] = useState<Open>(null);
  const [filingBusy, setFilingBusy] = useState(false);
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
  const floatSpace = selected ? Math.max(outerSpace, actionBarSpace()) : outerSpace;
  const pickedPhotos: Photo[] = filing
    ? filing.photos.filter((photo) => selected?.has(photo.id) === true)
    : [];
  const close = () => {
    setOpened(null);
  };

  const file = async (album: Album): Promise<void> => {
    if (!filing) return;
    setFilingBusy(true);
    try {
      const result = await filing.setInAlbum(picked, album, true);
      notice(albumChangeText(result, album.title, true));
      if (result.failed.length > 0) selection.replace(result.failed);
      else clear();
    } catch {
      notice(albumChangeText({ done: [], failed: picked }, album.title, true));
    } finally {
      setFilingBusy(false);
      close();
    }
  };

  const everything = all !== undefined && all.length > 0 && picked.length === all.length;
  const actions: BarAction[] =
    picked.length === 0
      ? []
      : [
          ...(filing && pickedPhotos.length === picked.length
            ? [
                {
                  key: 'album',
                  label: filingBusy ? 'Adding…' : 'Album',
                  icon: 'albums' as const,
                  accessibilityLabel: 'Add to album',
                  disabled: filingBusy,
                  onPress: () => {
                    setOpened('album');
                  },
                },
              ]
            : []),
          ...(onSave
            ? [
                {
                  key: 'save',
                  label: 'Save',
                  icon: 'download' as const,
                  accessibilityLabel: 'Save to phone',
                  onPress: () => {
                    onSave(picked);
                    clear();
                  },
                },
              ]
            : []),
          ...(onTeach
            ? [
                {
                  key: 'teach',
                  label: 'Teach',
                  icon: 'search' as const,
                  accessibilityLabel: 'Teach search a word',
                  onPress: () => {
                    onTeach(picked);
                    // With the right number picked, the sheet takes over; otherwise it says how many.
                    if (teachCountProblem(picked.length) === null) clear();
                  },
                },
              ]
            : []),
          {
            key: 'delete',
            label: 'Delete',
            icon: 'trash' as const,
            danger: true,
            onPress: () => {
              setOpened('delete');
            },
          },
        ];

  return {
    header: selected ? (
      <SelectionHeader count={picked.length} onCancel={clear}>
        {all !== undefined && all.length > 0 ? (
          <HeaderButton
            label={everything ? 'Select none' : 'Select all'}
            onPress={() => {
              selection.replace(everything ? [] : all);
            }}
          />
        ) : null}
      </SelectionHeader>
    ) : null,
    sheet: selected ? (
      <>
        <ActionBar actions={actions} />
        {opened === 'delete' ? (
          <ConfirmSheet
            title={deleteTitle(picked.length, noun)}
            body={trashNote(picked.length)}
            action="Delete"
            busyLabel="Deleting…"
            onCancel={close}
            onConfirm={async () => {
              const result = await library.deletePhotos(picked);
              close();
              notice(batchText(result, (done) => `${done} moved to Recently deleted`, noun));
              if (result.failed.length > 0) selection.replace(result.failed);
              else clear();
            }}
          />
        ) : null}
        {opened === 'album' && filing ? (
          <PickAlbumSheet
            photos={pickedPhotos}
            albums={filing.albums}
            onPick={(album) => {
              void file(album);
            }}
            onNew={() => {
              setOpened('naming');
            }}
            onCancel={close}
          />
        ) : null}
        {opened === 'naming' && filing ? (
          <NameSheet
            title="New album"
            action="Create and add"
            onSave={async (name) => {
              const made = await filing.createAlbum(name);
              await file(made);
            }}
            onCancel={close}
          />
        ) : null}
      </>
    ) : null,
    floatSpace,
    grid: {
      floatSpace,
      onPress: selected ? selection.toggle : open,
      onLongPress: selection.start,
      ...(selected ? { chosen: selected } : {}),
    },
  };
}
