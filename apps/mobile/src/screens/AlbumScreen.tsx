import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  addsByUpload,
  albumPhotos,
  albumSharing,
  canChangeAlbum,
} from '@arcafold/core/library/albums';
import type { Album } from '@arcafold/core/library/model';

import { photoCount } from '../library/album-text';
import { gridRows } from '../library/timeline';
import type { Library } from '../library/use-library';
import { fonts } from '../theme';
import { Button, Note } from '../ui/kit';
import { useNotice } from '../ui/notice';
import { usePalette } from '../ui/theme';
import {
  AddFromSheet,
  AlbumMenuSheet,
  DeleteAlbumSheet,
  LeaveAlbumSheet,
  NameSheet,
} from './AlbumSheets';
import { AppHeader, HeaderButton } from './AppHeader';
import { PhotoGrid } from './PhotoGrid';
import { usePickToDelete } from './use-pick-to-delete';

type Open = 'menu' | 'rename' | 'delete' | 'add' | 'leave' | null;

/** One album's photos, newest first by month, with its menu and a way to add more. */
export function AlbumScreen({
  album,
  library,
  initial,
  banner,
  onSettings,
  onBack,
  onOpen,
  onSave,
  onTeach,
  onChoose,
  onUpload,
  onShare,
  onLeave,
}: {
  album: Album;
  library: Library;
  initial: string;
  banner: ReactNode;
  onSettings: () => void;
  onBack: () => void;
  onOpen: (photoId: string) => void;
  /** Saves copies of photos to the phone's gallery, where it can. */
  onSave?: (photoIds: readonly string[]) => void;
  /** Teaches search a word from picked photos, while Smart search is on. */
  onTeach?: (photoIds: readonly string[]) => void;
  /** Opens the library to choose photos to put in this album. */
  onChoose: () => void;
  /** Opens the phone's photo picker to upload photos into this album. */
  onUpload: () => void;
  /** Opens the screen for sharing this album. */
  onShare: () => void;
  /** Leaves an album someone shared with you. */
  onLeave: () => Promise<void>;
}) {
  const palette = usePalette();
  const picking = usePickToDelete(library, onOpen, { onSave, onTeach });
  const notice = useNotice();
  const [open, setOpen] = useState<Open>(null);
  const photos = useMemo(() => albumPhotos(library.photos, album.id), [library.photos, album.id]);
  const rows = useMemo(() => gridRows(photos), [photos]);
  const changeable = canChangeAlbum(album);
  // An album shared with you that you may add to takes new photos from this phone.
  const uploadOnly = addsByUpload(album);
  // Your own albums, ones in a library you can change, and ones shared with you (to leave).
  const hasMenu = changeable || album.sharedAlbum === true;
  const sharing = albumSharing(album);
  const close = () => {
    setOpen(null);
  };

  const summary = (
    <View style={styles.summary}>
      <Text style={[styles.meta, { color: palette.muted }]}>
        {photos.length === 0 ? 'No photos yet' : photoCount(photos.length)}
        {sharing ? ` · ${sharing}` : ''}
      </Text>
      {(changeable || uploadOnly) && photos.length > 0 ? (
        <Button
          kind="secondary"
          label="Add photos"
          onPress={() => {
            setOpen('add');
          }}
        />
      ) : null}
    </View>
  );

  return (
    <View style={styles.fill}>
      {picking.header ?? (
        <AppHeader title={album.title} initial={initial} onSettings={onSettings} onBack={onBack}>
          {hasMenu ? (
            <HeaderButton
              label="⋯"
              accessibilityLabel="Album options"
              onPress={() => {
                setOpen('menu');
              }}
            />
          ) : null}
        </AppHeader>
      )}
      {banner}
      {photos.length === 0 ? (
        <View style={styles.centre}>
          <Text style={[styles.emptyTitle, { color: palette.text }]}>Nothing in here yet</Text>
          {sharing ? <Note>{sharing}</Note> : null}
          {changeable ? (
            <>
              <Note>Add photos from your library, or straight from this phone.</Note>
              <Button
                label="Add photos"
                onPress={() => {
                  setOpen('add');
                }}
              />
            </>
          ) : uploadOnly ? (
            <>
              <Note>
                Add photos from your library or this phone. Everyone it’s shared with sees them.
              </Note>
              <Button
                label="Add photos"
                onPress={() => {
                  setOpen('add');
                }}
              />
            </>
          ) : (
            <Note>Photos added to this album will show up here.</Note>
          )}
        </View>
      ) : (
        <PhotoGrid
          rows={rows}
          thumbs={library.thumbs}
          requestThumbs={library.requestThumbs}
          {...picking.grid}
          header={summary}
        />
      )}
      {open === 'menu' ? (
        <AlbumMenuSheet
          album={album}
          onShare={() => {
            close();
            onShare();
          }}
          onLeave={() => {
            setOpen('leave');
          }}
          onRename={() => {
            setOpen('rename');
          }}
          onDelete={() => {
            setOpen('delete');
          }}
          onCancel={close}
        />
      ) : null}
      {open === 'rename' ? (
        <NameSheet
          title="Rename album"
          action="Rename"
          initial={album.title}
          onSave={async (name) => {
            if (name !== album.title) await library.renameAlbum(album.id, name);
            close();
            notice(`Renamed to “${name}”`);
          }}
          onCancel={close}
        />
      ) : null}
      {open === 'delete' ? (
        <DeleteAlbumSheet
          album={album}
          count={photos.length}
          onDelete={async () => {
            await library.deleteAlbum(album.id);
            notice(`“${album.title}” deleted`);
            onBack();
          }}
          onCancel={close}
        />
      ) : null}
      {open === 'leave' ? (
        <LeaveAlbumSheet
          album={album}
          onLeave={async () => {
            await onLeave();
            notice(`You left “${album.title}”`);
            onBack();
          }}
          onCancel={close}
        />
      ) : null}
      {open === 'add' ? (
        <AddFromSheet
          canUpload={album.library === undefined || uploadOnly}
          onLibrary={() => {
            close();
            onChoose();
          }}
          onPhone={() => {
            close();
            onUpload();
          }}
          onCancel={close}
        />
      ) : null}
      {picking.sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 22, letterSpacing: -0.3 },
  summary: { paddingHorizontal: 16, paddingTop: 4, gap: 12 },
  meta: { fontSize: 14 },
});
