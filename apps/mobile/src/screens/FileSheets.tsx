import { MAX_FILE_NAME } from '@arcafold/core/file-types';
import type { Photo } from '@arcafold/core/library/model';

import { checkFileName } from '../library/files';
import type { FileChoices } from '../library/files';
import { Sheet, SheetOption } from '../ui/sheet';
import { NameSheet } from './AlbumSheets';

/** Renames a file. */
export function FileNameSheet({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <NameSheet
      title="Rename file"
      action="Save"
      label="File name"
      placeholder="Lease.pdf"
      initial={initial}
      maxLength={MAX_FILE_NAME}
      check={checkFileName}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
}

/**
 * One file's menu: what `choices` allows of renaming it, sharing it with someone, putting a
 * new version in its place, and taking a file shared with you out of your Files.
 */
export function FileActionsSheet({
  file,
  choices,
  onRename,
  onShare,
  onNewVersion,
  onLeave,
  onCancel,
}: {
  file: Photo;
  choices: FileChoices;
  onRename: () => void;
  onShare: () => void;
  onNewVersion: () => void;
  onLeave: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet title={file.file?.name ?? 'File'} onCancel={onCancel}>
      {choices.rename ? <SheetOption label="Rename" onPress={onRename} /> : null}
      {choices.share ? (
        <SheetOption
          label="Share"
          detail="Invite someone to view or edit just this file"
          onPress={onShare}
        />
      ) : null}
      {choices.newVersion ? (
        <SheetOption
          label="Upload new version"
          detail="Replaces it for everyone it’s shared with"
          onPress={onNewVersion}
        />
      ) : null}
      {choices.leave ? (
        <SheetOption
          label="Remove from my Files"
          detail="Its owner keeps it"
          danger
          onPress={onLeave}
        />
      ) : null}
    </Sheet>
  );
}
