import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { albumTitle, fitsAlbum } from '@arcafold/core/library/albums';
import { errorMessage } from '@arcafold/core/errors';
import type { Album, Photo } from '@arcafold/core/library/model';

import { photoCount } from '../library/album-text';
import { Banner, Button, Field } from '../ui/kit';
import { Sheet, SheetOption } from '../ui/sheet';

/** Names a new album, or renames one. Resolves once saved; a failure shows in the sheet. */
export function NameSheet({
  title,
  action,
  initial = '',
  onSave,
  onCancel,
}: {
  title: string;
  /** The button's label: "Create album", "Rename". */
  action: string;
  initial?: string;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = () => {
    if (busy) return;
    const checked = albumTitle(name);
    if ('error' in checked) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    onSave(checked.title).then(
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
      <Field
        label="Album name"
        placeholder="Our trip to…"
        value={name}
        maxLength={80}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
        onChangeText={(text) => {
          setName(text);
          setError(null);
        }}
        error={error}
      />
      <Button label={action} busyLabel="Saving…" busy={busy} onPress={submit} />
      <Button kind="link" label="Cancel" onPress={busy ? () => undefined : onCancel} />
    </Sheet>
  );
}

/** Asks before deleting an album. Its photos stay where they are. */
export function DeleteAlbumSheet({
  album,
  count,
  onDelete,
  onCancel,
}: {
  album: Album;
  count: number;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const where = album.library !== undefined ? `${album.library}’s library` : 'your library';
  const submit = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    onDelete().then(
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
    <Sheet
      title={`Delete “${album.title}”?`}
      body={
        count > 0
          ? `The album goes, but its ${photoCount(count)} stay in ${where}.`
          : 'The album is empty, so nothing else changes.'
      }
      busy={busy}
      onCancel={onCancel}
    >
      {error ? <Banner>{error}</Banner> : null}
      <Button label="Delete album" busyLabel="Deleting…" busy={busy} onPress={submit} />
      <Button kind="link" label="Cancel" onPress={busy ? () => undefined : onCancel} />
    </Sheet>
  );
}

/**
 * An album's menu. Your own albums can be shared, renamed or deleted; one in a library shared
 * with you can be renamed or deleted; one someone shared with you on its own can be left.
 */
export function AlbumMenuSheet({
  album,
  onShare,
  onRename,
  onDelete,
  onLeave,
  onCancel,
}: {
  album: Album;
  onShare: () => void;
  onRename: () => void;
  onDelete: () => void;
  onLeave: () => void;
  onCancel: () => void;
}) {
  if (album.sharedAlbum) {
    return (
      <Sheet title={album.title} onCancel={onCancel}>
        <SheetOption
          label="Leave album"
          detail="It goes from your albums. You’d need a new invite to see it again."
          danger
          onPress={onLeave}
        />
      </Sheet>
    );
  }
  return (
    <Sheet title={album.title} onCancel={onCancel}>
      {album.library === undefined ? (
        <SheetOption
          label="Share"
          detail={
            album.sharedWith?.length
              ? `Shared with ${album.sharedWith.join(', ')}`
              : 'Invite someone to see it'
          }
          onPress={onShare}
        />
      ) : null}
      <SheetOption label="Rename" onPress={onRename} />
      <SheetOption
        label="Delete album"
        detail="Its photos stay in the library"
        danger
        onPress={onDelete}
      />
    </Sheet>
  );
}

/** Asks before leaving an album someone shared with you. */
export function LeaveAlbumSheet({
  album,
  onLeave,
  onCancel,
}: {
  album: Album;
  onLeave: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    onLeave().then(
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
    <Sheet
      title={`Leave “${album.title}”?`}
      body={`${album.library ?? 'They'} shared it with you. Once you leave, you’d need a new invite to see it again.`}
      busy={busy}
      onCancel={onCancel}
    >
      {error ? <Banner>{error}</Banner> : null}
      <Button label="Leave album" busyLabel="Leaving…" busy={busy} onPress={submit} />
      <Button kind="link" label="Cancel" onPress={busy ? () => undefined : onCancel} />
    </Sheet>
  );
}

/** Where the photos to add to an album come from. */
export function AddFromSheet({
  canUpload,
  onLibrary,
  onPhone,
  onCancel,
}: {
  /** Whether photos can be uploaded into it from this phone (only into your own albums). */
  canUpload: boolean;
  onLibrary: () => void;
  onPhone: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet title="Add photos" onCancel={onCancel}>
      <SheetOption
        label="From your library"
        detail="Photos already in Arcafold"
        onPress={onLibrary}
      />
      {canUpload ? (
        <SheetOption
          label="From this phone"
          detail="Encrypted and added to the album"
          onPress={onPhone}
        />
      ) : null}
    </Sheet>
  );
}

/**
 * Picks an album to put a photo in, or makes a new one for it. Albums it can't go in (another
 * library's, or ones you can only view) aren't offered, and ones it's already in say so.
 */
export function PickAlbumSheet({
  photo,
  albums,
  onPick,
  onNew,
  onCancel,
}: {
  photo: Photo;
  albums: readonly Album[];
  onPick: (album: Album) => void;
  onNew: () => void;
  onCancel: () => void;
}) {
  const fitting = albums.filter((album) => fitsAlbum(photo, album));
  return (
    <Sheet title="Add to album" onCancel={onCancel}>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {photo.library === undefined ? <SheetOption label="+ New album" onPress={onNew} /> : null}
        {fitting.map((album) => {
          const inside = photo.albumIds.includes(album.id);
          return (
            <SheetOption
              key={album.id}
              label={album.title}
              {...(inside ? { detail: 'Already in this album' } : {})}
              disabled={inside}
              onPress={() => {
                onPick(album);
              }}
            />
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 0 },
  listContent: { gap: 10 },
});
