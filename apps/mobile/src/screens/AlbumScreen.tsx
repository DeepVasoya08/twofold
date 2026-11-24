import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  addsByUpload,
  albumCover,
  albumPhotos,
  albumSharing,
  canChangeAlbum,
} from '@arcafold/core/library/albums';
import type { Album } from '@arcafold/core/library/model';

import { MemoryImage } from '../../modules/memory-image';
import { dateSpan, photoCount } from '../library/album-text';
import { gridRows, photosInRows } from '../library/timeline';
import type { Library } from '../library/use-library';
import { fonts } from '../theme';
import { Button, Note } from '../ui/kit';
import { Icon } from '../ui/icons';
import { useNotice } from '../ui/notice';
import { PillButton } from '../ui/pill-button';
import { usePalette } from '../ui/theme';
import {
  AddFromSheet,
  AlbumMenuSheet,
  DeleteAlbumSheet,
  LeaveAlbumSheet,
  NameSheet,
} from './AlbumSheets';
import { PageTop, RoundButton } from './AppHeader';
import { PhotoGrid } from './PhotoGrid';
import { usePickToDelete } from './use-pick-to-delete';

type Open = 'menu' | 'rename' | 'delete' | 'add' | 'leave' | null;

/** One album's photos, newest first by month, with its menu and a way to add more. */
export function AlbumScreen({
  album,
  library,
  banner,
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
  banner: ReactNode;
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
  const notice = useNotice();
  const [open, setOpen] = useState<Open>(null);
  const photos = useMemo(() => albumPhotos(library.photos, album.id), [library.photos, album.id]);
  const rows = useMemo(() => gridRows(photos), [photos]);
  const all = useMemo(() => photosInRows(rows), [rows]);
  const picking = usePickToDelete(library, onOpen, { onSave, onTeach, filing: library, all });
  const changeable = canChangeAlbum(album);
  // An album shared with you that you may add to takes new photos from this phone.
  const uploadOnly = addsByUpload(album);
  // Your own albums, ones in a library you can change, and ones shared with you (to leave).
  const hasMenu = changeable || album.sharedAlbum === true;
  const sharing = albumSharing(album);
  const close = () => {
    setOpen(null);
  };

  const cover = useMemo(() => albumCover(library.photos, album), [library.photos, album]);
  const coverImage = cover ? (library.thumbs.get(cover.id) ?? null) : null;
  const { requestThumbs } = library;
  useEffect(() => {
    if (cover && !coverImage) requestThumbs([cover.id], true);
  }, [cover, coverImage, requestThumbs]);
  const span = useMemo(() => dateSpan(photos.map((photo) => photo.takenAt)), [photos]);
  const canAdd = changeable || uploadOnly;
  const yours = album.library === undefined && album.sharedAlbum !== true;

  const summary = (
    <View style={styles.summary}>
      <View style={styles.hero}>
        <View
          style={[styles.cover, { backgroundColor: palette.track }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {cover ? <MemoryImage imageId={coverImage} style={styles.coverImage} /> : null}
        </View>
        <View style={styles.heroText}>
          <Text
            style={[styles.title, { color: palette.text }]}
            accessibilityRole="header"
            numberOfLines={3}
          >
            {album.title}
          </Text>
          <Text style={[styles.meta, { color: palette.muted }]}>
            {photos.length === 0 ? 'No photos yet' : photoCount(photos.length)}
            {span ? ` · ${span}` : ''}
          </Text>
          {sharing ? (
            <View style={styles.sharedRow}>
              <Icon name="people" size={15} color={palette.accent} />
              <Text style={[styles.shared, { color: palette.text }]} numberOfLines={2}>
                {sharing}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {photos.length > 0 && (canAdd || yours || onSave) ? (
        <View style={styles.actions}>
          {canAdd ? (
            <PillButton
              label="Add photos"
              icon="plus"
              filled
              onPress={() => {
                setOpen('add');
              }}
            />
          ) : null}
          {yours ? <PillButton label="Share" icon="people" onPress={onShare} /> : null}
          {onSave ? (
            <PillButton
              label="Save"
              icon="download"
              accessibilityLabel="Save all to phone"
              onPress={() => {
                onSave(all);
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.fill}>
      {picking.header ?? (
        <PageTop onBack={onBack}>
          {hasMenu ? (
            <RoundButton
              icon="more"
              label="Album options"
              onPress={() => {
                setOpen('menu');
              }}
            />
          ) : null}
        </PageTop>
      )}
      {banner}
      {photos.length === 0 ? (
        <View style={styles.centre}>
          <Text style={[styles.emptyTitle, { color: palette.text }]}>
            Nothing in “{album.title}” yet
          </Text>
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

/** The cover's width; it's an arch a quarter taller than wide. */
const COVER = 118;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 22, letterSpacing: -0.3 },
  summary: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4, gap: 16 },
  hero: { flexDirection: 'row', alignItems: 'flex-end', gap: 16 },
  cover: {
    width: COVER,
    height: COVER * 1.25,
    borderTopLeftRadius: COVER / 2,
    borderTopRightRadius: COVER / 2,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    overflow: 'hidden',
  },
  coverImage: { width: COVER, height: COVER * 1.25 },
  heroText: { flex: 1, gap: 6, paddingBottom: 4 },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 30, letterSpacing: -0.8 },
  meta: { fontSize: 14 },
  sharedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shared: { flex: 1, fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
