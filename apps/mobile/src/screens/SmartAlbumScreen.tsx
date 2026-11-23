import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';

import { notLookedAtLine, notReadyLine } from '@arcafold/core/search/answer';
import { MAX_SMART_TITLE } from '@arcafold/core/search/smart-album';
import type { SmartAlbum } from '@arcafold/core/search/smart-album';

import { resultRows } from '../library/timeline';
import type { Library } from '../library/use-library';
import { smartTitleCheck } from '../search/smart-text';
import type { SmartAnswer } from '../search/use-smart-album';
import { Button, Note } from '../ui/kit';
import { useNotice } from '../ui/notice';
import { usePalette } from '../ui/theme';
import { NameSheet } from './AlbumSheets';
import { AppHeader, HeaderButton } from './AppHeader';
import { ConfirmSheet } from './ConfirmSheet';
import { PhotoGrid } from './PhotoGrid';

/**
 * A search saved as an album. It runs again each time it's opened, over the photos looked
 * at so far, so new photos that match show up on their own. Rename and Delete change only
 * the album, never the photos.
 */
export function SmartAlbumScreen({
  album,
  answer,
  shownIds,
  showMore,
  setShowMore,
  lookedAt,
  searchOn,
  library,
  initial,
  banner,
  onSettings,
  onBack,
  onOpen,
  onSave,
  onDelete,
}: {
  album: SmartAlbum;
  answer: SmartAnswer;
  /** The photos on screen, in order. */
  shownIds: readonly string[];
  showMore: boolean;
  setShowMore: (on: boolean) => void;
  lookedAt: { done: number; total: number };
  /** Whether Smart search is on on this phone; off, it can't find photos by what's in them. */
  searchOn: boolean;
  library: Pick<Library, 'thumbs' | 'requestThumbs'>;
  initial: string;
  banner: ReactNode;
  onSettings: () => void;
  onBack: () => void;
  onOpen: (photoId: string) => void;
  onSave: (album: SmartAlbum) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const palette = usePalette();
  const notice = useNotice();
  const [open, setOpen] = useState<'rename' | 'delete' | null>(null);
  useEffect(() => {
    if (open) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => {
      back.remove();
    };
  }, [open, onBack]);

  const { query, found, notLookedAt, changed } = answer;
  const rows = useMemo(() => resultRows(shownIds), [shownIds]);
  const best = found?.best.length ?? 0;
  const more = found?.more.length ?? 0;
  const ranked = query.what !== '' || query.like !== null || query.taught.length > 0;
  const notIndexed = lookedAt.total - lookedAt.done;
  const check = useMemo(
    () =>
      smartTitleCheck({
        text: album.text,
        ignore: album.ignore,
        like: album.like,
        savedAt: album.savedAt,
        what: album.what,
        vector: album.vector,
      }),
    [album],
  );

  const top = (
    <View style={styles.block}>
      <Note>Fills itself with photos that match, as they’re added. It runs on this phone.</Note>
      {query.chips.length > 0 ? (
        <View style={styles.chips}>
          {query.chips.map((chip) => (
            <View
              key={chip.key}
              style={[
                styles.chip,
                { borderColor: palette.border, backgroundColor: palette.surface },
              ]}
            >
              <Text style={[styles.chipText, { color: palette.text }]}>{chip.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {ranked && !searchOn ? (
        <Note>
          Smart search is off on this phone, so this album can’t find photos by what’s in them. Turn
          it on in Settings, under Smart features.
        </Note>
      ) : null}
      {changed ? (
        <Note>
          Part of this album’s search reads differently now, after a word or name changed. Save the
          search again to update it.
        </Note>
      ) : null}
      {searchOn && (notLookedAt.photo || notLookedAt.words.length > 0) ? (
        <Note>{notLookedAtLine(notLookedAt)}</Note>
      ) : null}
      {found && best === 0 && more === 0 ? (
        <Note>Nothing here yet. Photos that match show up as they’re added and looked at.</Note>
      ) : null}
    </View>
  );

  const footer =
    found && (best > 0 || more > 0) ? (
      <View style={styles.block}>
        {best > 0 && more > 0 && !showMore ? (
          <Button
            kind="secondary"
            label={`Show ${more.toLocaleString('en-US')} more`}
            onPress={() => {
              setShowMore(true);
            }}
          />
        ) : null}
        {ranked && Math.max(found.notReady, notIndexed) > 0 ? (
          <Note>{notReadyLine(Math.max(found.notReady, notIndexed))}</Note>
        ) : null}
      </View>
    ) : undefined;

  return (
    <View style={styles.fill}>
      <AppHeader title={album.title} initial={initial} onBack={onBack} onSettings={onSettings}>
        <HeaderButton
          label="Rename"
          onPress={() => {
            setOpen('rename');
          }}
        />
        <HeaderButton
          label="Delete"
          accessibilityLabel="Delete smart album"
          onPress={() => {
            setOpen('delete');
          }}
        />
      </AppHeader>
      {banner}
      <PhotoGrid
        rows={rows}
        thumbs={library.thumbs}
        requestThumbs={library.requestThumbs}
        onPress={onOpen}
        header={top}
        {...(footer ? { footer } : {})}
      />
      {open === 'rename' ? (
        <NameSheet
          title="Rename album"
          action="Rename"
          initial={album.title}
          maxLength={MAX_SMART_TITLE}
          check={check}
          onSave={async (title) => {
            await onSave({ ...album, title });
            setOpen(null);
            notice(`Renamed to “${title}”`);
          }}
          onCancel={() => {
            setOpen(null);
          }}
        />
      ) : null}
      {open === 'delete' ? (
        <ConfirmSheet
          title={`Delete “${album.title}”?`}
          body="Only the saved search goes. The photos it found stay where they are."
          action="Delete album"
          busyLabel="Deleting…"
          onConfirm={async () => {
            await onDelete();
            notice('Smart album deleted');
          }}
          onCancel={() => {
            setOpen(null);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  block: { gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 14, fontWeight: '600' },
});
