import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import {
  albumSharing,
  albumTitle,
  copiesInto,
  fitsAlbum,
  shareChoices,
} from '@arcafold/core/library/albums';
import { errorMessage } from '@arcafold/core/errors';
import type { Album, Photo } from '@arcafold/core/library/model';

import { photoCount } from '../library/album-text';
import { Banner, Button, Field } from '../ui/kit';
import { Sheet, SheetOption } from '../ui/sheet';

/**
 * Names a new album, or renames one (or names anything else, given its own `label` and
 * `check`). Resolves once saved; a failure shows in the sheet.
 */
export function NameSheet({
  title,
  action,
  initial = '',
  label = 'Album name',
  placeholder = 'Our trip to…',
  note,
  maxLength = 80,
  check = albumTitle,
  onSave,
  onCancel,
}: {
  title: string;
  /** The button's label: "Create album", "Rename". */
  action: string;
  initial?: string;
  label?: string;
  placeholder?: string;
  /** A line under the title saying what the name is for. */
  note?: string;
  maxLength?: number;
  /** The name to save, or why it can't be saved. */
  check?: (name: string) => { title: string } | { error: string };
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = () => {
    if (busy) return;
    const checked = check(name);
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
    <Sheet title={title} busy={busy} onCancel={onCancel} {...(note ? { body: note } : {})}>
      <Field
        label={label}
        placeholder={placeholder}
        value={name}
        maxLength={maxLength}
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
  /** Whether photos can be uploaded into it from this phone (not into a library shared with you). */
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
 * Picks an album to put photos in, or makes a new one for them. Albums they can't all go in
 * (another library's, or ones you can only view) aren't offered, and ones they're all already
 * in say so.
 */
export function PickAlbumSheet({
  photos,
  albums,
  onPick,
  onNew,
  onCancel,
}: {
  photos: readonly Photo[];
  albums: readonly Album[];
  onPick: (album: Album) => void;
  onNew: () => void;
  onCancel: () => void;
}) {
  const fitting = albums.filter((album) =>
    photos.every((photo) => fitsAlbum(photo, album) || copiesInto(photo, album)),
  );
  const yours = photos.every((photo) => photo.library === undefined);
  return (
    <Sheet title="Add to album" onCancel={onCancel}>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {yours ? <SheetOption label="+ New album" onPress={onNew} /> : null}
        {fitting.map((album) => {
          const inside = photos.every((photo) => photo.albumIds.includes(album.id));
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

/**
 * Picks the album to share photos through, as on the web: one of your own (those already
 * shared with someone first, so sharing more with the same people doesn't make another
 * album), or a new one. The album's invite comes next, where you choose what they can do.
 */
export function ShareThroughSheet({
  photos,
  albums,
  onPick,
  onNew,
  onCancel,
}: {
  photos: readonly Photo[];
  albums: readonly Album[];
  onPick: (album: Album) => void;
  onNew: () => void;
  onCancel: () => void;
}) {
  const choices = shareChoices(albums, photos);
  return (
    <Sheet
      title={`Share ${photoCount(photos.length)}`}
      body="Photos are shared through an album. Pick one, then invite people and choose what they can do. Everyone invited sees the same album."
      onCancel={onCancel}
    >
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        <SheetOption
          label="+ New shared album"
          detail="Name it, then invite someone"
          onPress={onNew}
        />
        {choices.map((album) => (
          <SheetOption
            key={album.id}
            label={album.title}
            detail={albumSharing(album) ?? 'Not shared yet'}
            onPress={() => {
              onPick(album);
            }}
          />
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 0 },
  listContent: { gap: 10 },
});
