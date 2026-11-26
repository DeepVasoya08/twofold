import { useMemo, useRef, useState } from 'react';

import type { SpaceKeys } from '@arcafold/crypto';

import { useAccount } from '../app/account';
import { useDownloads } from '../app/downloads';
import { useToast } from '../app/toast';
import { prepareFile, useUploads } from '../app/uploads';
import { documentPhotos, useDocumentLooks } from '../app/document-photos';
import { useDocumentPhotosView, useFileView } from '../app/views';
import { TRASH_DAYS, allItems, foldersOf, timelinePhotos, trashNote, useVault } from '../app/vault';
import { Link, useRouter } from '../app/router';
import { paths } from '../app/routes';
import type { PhotoContext } from '../app/routes';
import {
  changeableHere,
  childFolders,
  editableFile,
  folderCounts,
  folderOf,
  folderPath,
  folderTrash,
  folderTree,
  inFiles,
  itemsIn,
  liveFolders,
} from '@arcafold/core/library/folders';
import { FileShareDialog, FolderShareDialog } from '../components/AlbumShareDialog';
import { leaveJoined } from '@arcafold/core/sharing';
import { FolderNameDialog, FolderPicker } from '../components/FolderDialogs';
import { MAX_FILE_NAME, cleanFileName } from '@arcafold/core/file-types';
import { FolderTile, folderSummary } from '../components/FolderTile';
import { dropProps } from '../components/folder-drag';
import type { Dropped } from '../components/folder-drag';
import { Menu } from '../components/Menu';
import { PageHeader } from '../components/AppShell';
import { Dialog } from '../components/Dialog';
import { AlbumPicker } from '../components/AlbumPicker';
import { EmptyState } from '../components/EmptyState';
import { FileRow, FileTile, fileDetails } from '../components/FileRow';
import { Icon } from '../components/Icon';
import type { MenuItem } from '../components/Menu';
import { albumChoices } from '@arcafold/core/library/albums';
import { MoveSpaceDialog, moveLabel } from '../components/MoveSpaceDialog';
import { PhotoGrid } from '../components/PhotoGrid';
import { FILE_VIEW_CHOICES, ViewPicker } from '../components/ViewPicker';
import { CATEGORIES, categoryLabel } from '@arcafold/core/file-categories';
import type { Category } from '@arcafold/core/file-categories';
import { lookCategory } from '../lib/file-sort/looks';
import type { DocumentLook } from '../lib/file-sort/looks';
import { groupByMonth, pluralize } from '../lib/format';
import { formatBytes } from '../lib/storage-usage';
import { errorMessage } from '@arcafold/core/errors';
import type { Folder, Photo } from '@arcafold/core/library/model';

import './files.css';
import './gallery.css';

/**
 * A file's category: the one it was sorted into, or Other until it is. A scan whose text
 * didn't say (sorted as Other, not by you) goes where its look says, when that's clear.
 */
export function categoryOf(item: Photo, look?: DocumentLook): Category {
  const file = item.file;
  const sorted = file?.category ?? 'other';
  if (sorted !== 'other' || file?.sortedByYou || !look) return sorted;
  return lookCategory(look) ?? 'other';
}

/** Which categories to offer as filters: those with files, in the fixed order. */
export function categoryCounts(
  files: readonly Photo[],
  looks: ReadonlyMap<string, DocumentLook> = new Map(),
): [Category, number][] {
  const counts = new Map<Category, number>();
  for (const item of files) {
    const category = categoryOf(item, looks.get(item.id));
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return CATEGORIES.flatMap((category) => {
    const count = counts.get(category);
    return count ? [[category, count] as [Category, number]] : [];
  });
}

/** The Document photos choice among the category filters. */
const DOCUMENT_PHOTOS = 'document-photos';
type Shown = Category | 'all' | typeof DOCUMENT_PHOTOS;

function shownLabel(shown: Shown): string {
  if (shown === 'all') return 'All';
  if (shown === DOCUMENT_PHOTOS) return 'Document photos';
  return categoryLabel(shown);
}

/**
 * Files that aren't photos: PDFs, documents and anything else but videos, encrypted on this
 * device like photos, and sorted into categories on the device that added them. You keep
 * them in folders of your own (`folderId` is the one open), which can hold folders too.
 */
export function Files({ folderId }: { folderId?: string } = {}) {
  const vault = useVault();
  const { state, space, status } = vault;
  const { navigate } = useRouter();
  const { openDialog } = useUploads();
  const downloads = useDownloads();
  const account = useAccount();
  const { otherSpaceOpen } = account;
  const keys = account.state.status === 'unlocked' ? account.state.session.opened.space : null;
  const toast = useToast();
  const [deleting, setDeleting] = useState<Photo | null>(null);
  const [renaming, setRenaming] = useState<Photo | null>(null);
  const [moving, setMoving] = useState<Photo | null>(null);
  const [sorting, setSorting] = useState<Photo | null>(null);
  const [filing, setFiling] = useState<Photo | null>(null);
  /** Files or a folder being moved into another folder. */
  const [placing, setPlacing] = useState<Dropped | null>(null);
  /** A folder being made, renamed or deleted. */
  const [folderDialog, setFolderDialog] = useState<
    { kind: 'new' } | { kind: 'rename' | 'delete'; folder: Folder } | null
  >(null);
  /** A folder whose sharing is open. */
  const [sharing, setSharing] = useState<Folder | null>(null);
  /** A file whose sharing is open, by the id it is shared under. */
  const [sharingFile, setSharingFile] = useState<{ shareId: string; name: string } | null>(null);
  /** A file shared with you to edit, getting a new version from the file picker. */
  const [replacing, setReplacing] = useState<Photo | null>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState<Shown>('all');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useFileView();
  const [hidden] = useDocumentPhotosView();

  const folders = foldersOf(state);
  const live = useMemo(() => liveFolders(folders), [folders]);
  const here = folderId === undefined ? undefined : live.get(folderId);
  const path = useMemo(
    () => (folderId === undefined ? [] : folderPath(folders, folderId)),
    [folders, folderId],
  );
  // Of what single shares hold, only files shared on their own or in a folder shared with you
  // belong in Files.
  const files = useMemo(
    () =>
      [...(state.files ?? [])]
        .filter((item) => inFiles(item, folders))
        .sort((a, b) => b.takenAt.localeCompare(a.takenAt)),
    [state.files, folders],
  );
  const total = files.reduce((sum, item) => sum + (item.size ?? 0), 0);
  const looks = useDocumentLooks();
  const counts = useMemo(() => categoryCounts(files, looks), [files, looks]);
  const pictures = useMemo(() => documentPhotos(state, looks), [state, looks]);
  const choices: [Shown, number][] = [
    ['all', files.length],
    ...(pictures.length > 0 ? [[DOCUMENT_PHOTOS, pictures.length] as [Shown, number]] : []),
    ...counts,
  ];
  // Categories cover every folder, so they're offered at the top of Files only. A choice
  // emptied (its last file moved or deleted) falls back to All.
  const filter =
    folderId === undefined && choices.some(([choice]) => choice === shown) ? shown : 'all';
  const atLevel = filter === 'all';
  const level = folderId ?? null;
  const subfolders = atLevel ? childFolders(folders, level) : [];
  const listed = atLevel
    ? itemsIn(files, folders, level)
    : filter === DOCUMENT_PHOTOS
      ? []
      : files.filter((item) => categoryOf(item, looks.get(item.id)) === filter);
  // Photos uploaded into a folder show there as well as in Photos.
  const folderPhotos =
    folderId === undefined ? [] : itemsIn(timelinePhotos(state), folders, folderId);
  const label = (item: Photo) => categoryOf(item, looks.get(item.id));
  const readOnlyHere = here?.viewOnly === true;
  const from: PhotoContext | undefined =
    folderId === undefined ? undefined : { kind: 'folder', folderId };

  const run = (work: () => Promise<void>, done: string, undo?: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    work().then(
      () => {
        setBusy(false);
        setDeleting(null);
        setMoving(null);
        setSorting(null);
        setFiling(null);
        setPlacing(null);
        setFolderDialog(null);
        // Some steps only open something, with nothing to say.
        if (done === '') return;
        toast.show(
          done,
          undo && {
            label: 'Undo',
            run: () => {
              undo().catch((error: unknown) => {
                toast.show(errorMessage(error));
              });
            },
          },
        );
      },
      (error: unknown) => {
        setBusy(false);
        toast.show(errorMessage(error));
      },
    );
  };

  const move = (item: Photo, keys?: SpaceKeys) => {
    run(
      () => vault.movePhoto(item.id, keys),
      `Moved to your ${space === 'private' ? 'library' : 'private space'}`,
    );
  };

  /** Puts a file, or a folder, into `target` (or the top of Files, for null). */
  const place = (what: Dropped, target: string | null) => {
    const where = target === null ? 'Files' : `“${live.get(target)?.name ?? 'the folder'}”`;
    if (what.kind === 'folder') {
      const folder = live.get(what.id);
      if (!folder || what.id === target || (folder.parentId ?? null) === target) return;
      const before = folder.parentId ?? null;
      run(
        () => vault.moveFolder(what.id, target),
        `Moved “${folder.name}” to ${where}`,
        () => vault.moveFolder(what.id, before),
      );
      return;
    }
    const item = allItems(state).find((candidate) => candidate.id === what.id);
    if (!item) return;
    const before = folderOf(item, live) ?? null;
    if (before === target) return;
    run(
      async () => {
        const result = await vault.moveToFolder([what.id], target);
        if (result.failed.length > 0) throw result.error;
      },
      `Moved to ${where}`,
      async () => {
        await vault.moveToFolder([what.id], before);
      },
    );
  };

  /** Whether a file is yours to change, or in a folder shared with you to edit. */
  const editable = (item: Photo) => editableFile(item, folders);

  /** Leaves a file shared with you on its own: it goes from your Files. */
  const leaveFile = (item: Photo) => {
    const joinedId = item.joinedId;
    if (!keys || !joinedId) return;
    run(
      async () => {
        await leaveJoined(keys, joinedId);
        account.reloadVault();
      },
      `Removed “${item.file?.name ?? 'the file'}” from your Files`,
    );
  };

  const shareFile = (item: Photo) => {
    run(async () => {
      const shareId = await vault.shareFile(item.id);
      setSharingFile({ shareId, name: item.file?.name ?? 'File' });
    }, '');
  };

  const menuFor = (item: Photo): MenuItem[] => {
    const items: MenuItem[] = [
      {
        label: 'Download',
        icon: 'download',
        onSelect: () => {
          downloads.start([item.id]);
        },
      },
    ];
    const leave: MenuItem = {
      label: 'Remove from my Files',
      icon: 'logout',
      onSelect: () => {
        leaveFile(item);
      },
    };
    if (!editable(item)) return item.sharedFile ? [...items, leave] : items;
    const rename: MenuItem = {
      label: 'Rename',
      icon: 'pencil',
      onSelect: () => {
        setRenaming(item);
      },
    };
    const moveTo: MenuItem = {
      label: 'Move to folder',
      icon: 'folder',
      onSelect: () => {
        setPlacing({ kind: 'item', id: item.id });
      },
    };
    const remove: MenuItem = {
      label: 'Delete',
      icon: 'trash',
      danger: true,
      onSelect: () => {
        setDeleting(item);
      },
    };
    if (item.sharedFile) {
      // A file shared with you on its own to edit: rename it, or upload a new version.
      return [
        ...items,
        rename,
        {
          label: 'Upload new version',
          icon: 'upload',
          onSelect: () => {
            setReplacing(item);
            versionInput.current?.click();
          },
        },
        leave,
      ];
    }
    if (item.sharedAlbum) {
      // In a folder shared with you to edit, a file can be renamed, moved inside it, or
      // deleted (into its owner's Recently deleted). The rest is up to its owner.
      return [...items, ...(item.file ? [rename] : []), moveTo, remove];
    }
    if (item.file) items.push(rename);
    if (item.file && item.library === undefined) {
      items.push({
        label: 'Share',
        icon: 'share',
        onSelect: () => {
          shareFile(item);
        },
      });
    }
    items.push({
      label: 'Move to folder',
      icon: 'folder',
      onSelect: () => {
        setPlacing({ kind: 'item', id: item.id });
      },
    });
    if (albumChoices(state.albums, [item]).length > 0 || item.library === undefined) {
      items.push({
        label: 'Add to album',
        icon: 'albums',
        onSelect: () => {
          setFiling(item);
        },
      });
    }
    items.push({
      label: 'Move to category',
      icon: 'sparkle',
      onSelect: () => {
        setSorting(item);
      },
    });
    if (item.library === undefined) {
      items.push({
        label: moveLabel(space),
        icon: 'eye-off',
        onSelect: () => {
          if (otherSpaceOpen) move(item);
          else setMoving(item);
        },
      });
    }
    items.push(remove);
    return items;
  };

  // A folder shared with you to edit can be changed inside, but it is its owner's to rename,
  // move, delete or share.
  const folderMenu = (folder: Folder): MenuItem[] =>
    !changeableHere(folder)
      ? []
      : [
          {
            label: 'Rename',
            icon: 'pencil',
            onSelect: () => {
              setFolderDialog({ kind: 'rename', folder });
            },
          },
          // Only your own folders can be shared; a library you joined is its owner's to share.
          ...(folder.library === undefined && !folder.sharedFolder
            ? [
                {
                  label: 'Share',
                  icon: 'share',
                  onSelect: () => {
                    setSharing(folder);
                  },
                } satisfies MenuItem,
              ]
            : []),
          {
            label: 'Move to folder',
            icon: 'folder',
            onSelect: () => {
              setPlacing({ kind: 'folder', id: folder.id });
            },
          },
          {
            label: 'Delete folder',
            icon: 'trash',
            danger: true,
            onSelect: () => {
              setFolderDialog({ kind: 'delete', folder });
            },
          },
        ];

  const upload = !readOnlyHere && (
    <button type="button" className="btn btn--primary" onClick={openDialog}>
      <Icon name="upload" size={18} />
      {here ? 'Upload here' : 'Add files'}
    </button>
  );
  const newFolder = !readOnlyHere && (
    <button
      type="button"
      className="btn btn--secondary"
      onClick={() => {
        setFolderDialog({ kind: 'new' });
      }}
    >
      <Icon name="plus" size={18} />
      New folder
    </button>
  );
  const canDrop = !readOnlyHere;
  const dropInto = (target: string) =>
    canDrop
      ? (what: Dropped) => {
          place(what, target);
        }
      : undefined;

  if (folderId !== undefined && !here) {
    return (
      <div className="page">
        <PageHeader title="Files" back={{ to: paths.files, label: 'Files' }} />
        {status !== 'loading' && (
          <EmptyState icon="folder" title="This folder isn’t here">
            It may have been deleted or moved to Recently deleted.
          </EmptyState>
        )}
      </div>
    );
  }

  const nothing = files.length === 0 && pictures.length === 0 && live.size === 0;
  const emptyHere =
    here !== undefined &&
    subfolders.length === 0 &&
    listed.length === 0 &&
    folderPhotos.length === 0;

  const deletingFolder = folderDialog?.kind === 'delete' ? folderDialog.folder : null;
  const deletingCounts = deletingFolder
    ? folderTrash(folders, allItems(state), deletingFolder.id)
    : null;

  return (
    <div className="page">
      {here && <FolderPath path={path} onDrop={canDrop ? place : undefined} />}
      <PageHeader
        title={here?.name ?? 'Files'}
        subtitle={
          here
            ? folderSummary(folderCounts(folders, [...files, ...timelinePhotos(state)], here.id)) +
              (here.library === undefined ? '' : ` · Shared by ${here.library}`) +
              (here.sharedWith?.length ? ` · Shared with ${here.sharedWith.join(', ')}` : '')
            : files.length > 0
              ? `${pluralize(files.length, 'file')} · ${formatBytes(total)}`
              : 'PDFs, documents and other files, encrypted like your photos'
        }
        actions={
          !nothing && (
            <>
              <ViewPicker choices={FILE_VIEW_CHOICES} value={view} onChange={setView} />
              {newFolder}
              {upload}
              {here && folderMenu(here).length > 0 && (
                <Menu label="Folder actions" items={folderMenu(here)} icon="more-vertical" />
              )}
            </>
          )
        }
      />

      {nothing ? (
        <EmptyState
          icon="file"
          title="No files yet"
          action={
            <>
              {upload}
              {newFolder}
            </>
          }
        >
          Add PDFs, documents, spreadsheets and other files, and keep them in folders. They’re
          encrypted on this device before they’re uploaded. Videos can’t be added yet.
        </EmptyState>
      ) : (
        <>
          {folderId === undefined && choices.length > 2 && (
            <div className="file-categories" role="group" aria-label="Show category">
              {choices.map(([category, count]) => (
                <button
                  key={category}
                  type="button"
                  className="file-categories__option"
                  aria-pressed={filter === category}
                  onClick={() => {
                    setShown(category);
                  }}
                >
                  {shownLabel(category)}
                  <span className="file-categories__count">{count}</span>
                </button>
              ))}
            </div>
          )}
          {subfolders.length > 0 && (
            <section className="folders" aria-labelledby="folders-title">
              <h2 className="folders__title" id="folders-title">
                Folders
              </h2>
              <ul className="folder-grid">
                {subfolders.map((folder) => (
                  <FolderTile
                    key={folder.id}
                    folder={folder}
                    summary={folderSummary(
                      folderCounts(folders, [...files, ...timelinePhotos(state)], folder.id),
                    )}
                    menu={folderMenu(folder)}
                    onDrop={
                      // Inside a folder shared with you, things move between its folders.
                      folder.viewOnly || (folder.sharedFolder && !here?.sharedFolder)
                        ? undefined
                        : dropInto(folder.id)
                    }
                  />
                ))}
              </ul>
            </section>
          )}
          {emptyHere && (
            <EmptyState icon="folder" title="This folder is empty" action={upload}>
              {readOnlyHere
                ? 'Nothing has been put in this folder yet.'
                : 'Upload files here, or move files in from their menu or by dragging them onto the folder.'}
            </EmptyState>
          )}
          {folderPhotos.length > 0 && (
            <section className="month" aria-labelledby="folder-photos-title">
              <header className="month__header">
                <h2 className="month__title" id="folder-photos-title">
                  Photos
                </h2>
              </header>
              <PhotoGrid
                photos={folderPhotos}
                context={{ kind: 'folder', folderId: here?.id ?? '' }}
              />
            </section>
          )}
          {filter === DOCUMENT_PHOTOS ? (
            <div className="file-months" role="region" aria-label="Document photos">
              <p className="file-photos__note">
                Photos that look like receipts, documents, screenshots or notes. They’re still in
                Photos{hidden === 'hide' ? ', but hidden from the timeline' : ''}.
              </p>
              {groupByMonth(pictures).map((month) => (
                <section
                  key={month.key}
                  className="month"
                  aria-labelledby={`document-photos-${month.key}`}
                >
                  <header className="month__header">
                    <h2 className="month__title" id={`document-photos-${month.key}`}>
                      {month.label}
                    </h2>
                  </header>
                  <PhotoGrid photos={month.photos} context={{ kind: 'documents' }} />
                </section>
              ))}
            </div>
          ) : (
            listed.length > 0 && (
              <div className="file-months" role="region" aria-label="Files">
                {groupByMonth(listed).map((month) => (
                  <section
                    key={month.key}
                    className="month"
                    aria-labelledby={`files-month-${month.key}`}
                  >
                    <header className="month__header">
                      <h2 className="month__title" id={`files-month-${month.key}`}>
                        {month.label}
                      </h2>
                    </header>
                    <ul className={view === 'grid' ? 'file-grid' : 'file-list'}>
                      {month.photos.map((item) => {
                        const draggable = canDrop && editable(item) && live.size > 0;
                        const where = atLevel ? null : folderOf(item, live);
                        // Filtered by category, files come from every folder: say which.
                        const inFolder = where ? ` · in ${live.get(where)?.name ?? ''}` : '';
                        const details =
                          fileDetails(item, filter === 'all' ? label(item) : null) + inFolder;
                        return view === 'grid' ? (
                          <FileTile
                            key={item.id}
                            item={item}
                            details={fileDetails(item, null)}
                            menu={menuFor(item)}
                            draggable={draggable}
                            {...(from && { from })}
                          />
                        ) : (
                          <FileRow
                            key={item.id}
                            item={item}
                            details={details}
                            menu={menuFor(item)}
                            draggable={draggable}
                            {...(from && { from })}
                          />
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )
          )}
        </>
      )}

      <input
        ref={versionInput}
        type="file"
        hidden
        aria-label="Choose a new version"
        onChange={(event) => {
          const chosen = event.currentTarget.files?.[0];
          const target = replacing;
          event.currentTarget.value = '';
          if (!chosen || !target) return;
          run(
            async () => {
              await vault.replaceFile(target.id, await prepareFile(chosen));
              setReplacing(null);
            },
            `Uploaded a new version of “${target.file?.name ?? 'the file'}”`,
          );
        }}
      />
      {sharingFile && (
        <FileShareDialog
          open
          shareId={sharingFile.shareId}
          name={sharingFile.name}
          onClose={() => {
            setSharingFile(null);
          }}
        />
      )}
      {sharing && (
        <FolderShareDialog
          open
          folder={sharing}
          onClose={() => {
            setSharing(null);
          }}
        />
      )}
      <FolderNameDialog
        open={folderDialog?.kind === 'new'}
        title={here ? `New folder in “${here.name}”` : 'New folder'}
        action="Create"
        onClose={() => {
          setFolderDialog(null);
        }}
        onSave={async (name) => {
          const folder = await vault.createFolder(name, here?.id);
          setFolderDialog(null);
          toast.show(`Made “${folder.name}”`);
        }}
      />

      <FolderNameDialog
        open={folderDialog?.kind === 'rename'}
        title="Rename folder"
        action="Save"
        initial={folderDialog?.kind === 'rename' ? folderDialog.folder.name : ''}
        onClose={() => {
          setFolderDialog(null);
        }}
        onSave={async (name) => {
          if (folderDialog?.kind !== 'rename') return;
          await vault.renameFolder(folderDialog.folder.id, name);
          setFolderDialog(null);
          toast.show(`Renamed to “${name.trim()}”`);
        }}
      />

      <Dialog
        open={deletingFolder !== null}
        onClose={() => {
          setFolderDialog(null);
        }}
        title={`Delete “${deletingFolder?.name ?? ''}”?`}
        description={
          deletingFolder?.sharedFolder
            ? `It goes to ${deletingFolder.library ?? 'its owner'}’s Recently deleted, with what’s inside it, where they can restore it.`
            : deletingCounts && deletingCounts.itemIds.length + deletingCounts.folderIds.length > 1
              ? `The folder and ${deletedInside(deletingCounts)} go to Recently deleted. You can restore them for ${String(TRASH_DAYS)} days.`
              : `The folder goes to Recently deleted. You can restore it for ${String(TRASH_DAYS)} days.`
        }
      >
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setFolderDialog(null);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              if (!deletingFolder) return;
              const leave = deletingFolder.id === folderId;
              run(async () => {
                await vault.deleteFolder(deletingFolder.id);
                if (leave) {
                  const parent = path.at(-2);
                  navigate(parent ? paths.folder(parent.id) : paths.files);
                }
              }, 'Folder deleted');
            }}
          >
            Delete folder
          </button>
        </div>
      </Dialog>

      <FolderPicker
        open={placing !== null}
        title={placing?.kind === 'folder' ? 'Move folder to…' : 'Move to folder'}
        folders={folders.filter((folder) => {
          const subject =
            placing?.kind === 'item'
              ? allItems(state).find((item) => item.id === placing.id)
              : live.get(placing?.id ?? '');
          return folder.library === subject?.library && !folder.viewOnly;
        })}
        start={folderId ?? null}
        blocked={placing?.kind === 'folder' ? folderTree(folders, placing.id) : new Set()}
        busy={busy}
        onClose={() => {
          setPlacing(null);
        }}
        onPick={(target) => {
          if (placing) place(placing, target);
          setPlacing(null);
        }}
        onCreate={(name, parentId) => vault.createFolder(name, parentId ?? undefined)}
      />

      <AlbumPicker
        open={filing !== null}
        photos={filing ? [filing] : []}
        busy={busy}
        onClose={() => {
          setFiling(null);
        }}
        onPick={(album) => {
          if (filing) {
            run(async () => {
              const result = await vault.setDetails([filing.id], { album, included: true });
              if (result.failed.length > 0) throw result.error;
            }, `Added to “${album.title}”`);
          }
        }}
      />

      <CategoryDialog
        file={sorting}
        current={sorting ? label(sorting) : 'other'}
        busy={busy}
        onClose={() => {
          setSorting(null);
        }}
        onChoose={(category) => {
          if (sorting) {
            run(() => vault.sortFile(sorting.id, category), `Moved to ${categoryLabel(category)}`);
          }
        }}
      />

      <FolderNameDialog
        open={renaming !== null}
        title="Rename file"
        action="Save"
        label="File name"
        maxLength={MAX_FILE_NAME}
        initial={renaming?.file?.name ?? ''}
        onClose={() => {
          setRenaming(null);
        }}
        onSave={async (name) => {
          if (!renaming) return;
          await vault.renameFile(renaming.id, name);
          setRenaming(null);
          toast.show(`Renamed to “${cleanFileName(name)}”`);
        }}
      />

      <Dialog
        open={deleting !== null}
        onClose={() => {
          setDeleting(null);
        }}
        title={`Delete ${deleting?.file?.name ?? 'this file'}?`}
        description={
          deleting?.sharedAlbum
            ? `It goes to ${deleting.library ?? 'its owner'}’s Recently deleted, where they can restore it.`
            : trashNote(1)
        }
      >
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setDeleting(null);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={() => {
              if (deleting) run(() => vault.deletePhoto(deleting.id), 'File deleted');
            }}
          >
            Delete
          </button>
        </div>
      </Dialog>

      <MoveSpaceDialog
        open={moving !== null}
        space={space}
        count={1}
        noun="file"
        busy={busy}
        onClose={() => {
          setMoving(null);
        }}
        onUnlocked={(keys) => {
          if (moving) move(moving, keys);
        }}
      />
    </div>
  );
}

/** "3 files and 1 folder", for what goes along with a deleted folder. */
function deletedInside(counts: { folderIds: string[]; itemIds: string[] }): string {
  const folders = counts.folderIds.length - 1;
  const parts = [
    ...(counts.itemIds.length > 0 ? [pluralize(counts.itemIds.length, 'file')] : []),
    ...(folders > 0 ? [pluralize(folders, 'folder')] : []),
  ];
  return `its ${parts.join(' and ')}`;
}

/** Where a folder is: Files, then each folder down to it. Each step takes drops. */
function FolderPath({
  path,
  onDrop,
}: {
  path: readonly Folder[];
  onDrop: ((what: Dropped, target: string | null) => void) | undefined;
}) {
  return (
    <nav className="folder-path" aria-label="Folder path">
      <PathStep to={paths.files} label="Files" target={null} onDrop={onDrop} />
      {path.slice(0, -1).map((folder) => (
        <PathStep
          key={folder.id}
          to={paths.folder(folder.id)}
          label={folder.name}
          target={folder.id}
          onDrop={onDrop}
        />
      ))}
    </nav>
  );
}

function PathStep({
  to,
  label,
  target,
  onDrop,
}: {
  to: string;
  label: string;
  target: string | null;
  onDrop: ((what: Dropped, target: string | null) => void) | undefined;
}) {
  const [over, setOver] = useState(false);
  return (
    <>
      <Link
        to={to}
        className={`folder-path__step${over ? ' folder-path__step--over' : ''}`}
        {...(onDrop &&
          dropProps((what) => {
            onDrop(what, target);
          }, setOver))}
      >
        {label}
      </Link>
      <Icon name="chevron-right" size={14} />
    </>
  );
}

/** Picks a file's category. Your choice also teaches the sorting for files like it. */
function CategoryDialog({
  file,
  current,
  busy,
  onClose,
  onChoose,
}: {
  file: Photo | null;
  current: Category;
  busy: boolean;
  onClose: () => void;
  onChoose: (category: Category) => void;
}) {
  const [picked, setPicked] = useState<{ fileId: string; category: Category } | null>(null);
  const chosen = picked && picked.fileId === file?.id ? picked.category : current;
  return (
    <Dialog
      open={file !== null}
      onClose={onClose}
      title="Move to category"
      description="Files like this one will go there too."
    >
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          onChoose(chosen);
        }}
      >
        <fieldset className="category-choices">
          <legend className="visually-hidden">Category</legend>
          {CATEGORIES.map((category) => (
            <label key={category} className="checkbox">
              <input
                type="radio"
                name="category"
                checked={chosen === category}
                onChange={() => {
                  if (file) setPicked({ fileId: file.id, category });
                }}
              />
              <span>{categoryLabel(category)}</span>
            </label>
          ))}
        </fieldset>
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
            Move
          </button>
        </div>
      </form>
    </Dialog>
  );
}
