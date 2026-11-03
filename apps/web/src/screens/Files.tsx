import { useMemo, useState } from 'react';

import type { SpaceKeys } from '@arcafold/crypto';

import { useAccount } from '../app/account';
import { errorMessage } from '../app/account-ops';
import { useDownloads } from '../app/downloads';
import { useToast } from '../app/toast';
import { useUploads } from '../app/uploads';
import { documentPhotos, useDocumentLooks } from '../app/document-photos';
import { useDocumentPhotosView, useFileView } from '../app/views';
import { isViewOnly, trashNote, useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { Dialog } from '../components/Dialog';
import { AlbumPicker } from '../components/AlbumPicker';
import { EmptyState } from '../components/EmptyState';
import { FileRow, FileTile, fileDetails } from '../components/FileRow';
import { Icon } from '../components/Icon';
import type { MenuItem } from '../components/Menu';
import { albumChoices } from '../components/AlbumPicker';
import { MoveSpaceDialog, moveLabel } from '../components/MoveSpaceDialog';
import { PhotoGrid } from '../components/PhotoGrid';
import { FILE_VIEW_CHOICES, ViewPicker } from '../components/ViewPicker';
import { CATEGORIES, categoryLabel } from '../lib/file-sort/categories';
import type { Category } from '../lib/file-sort/categories';
import { lookCategory } from '../lib/file-sort/looks';
import type { DocumentLook } from '../lib/file-sort/looks';
import { groupByMonth, pluralize } from '../lib/format';
import { formatBytes } from '../lib/storage-usage';
import type { Photo } from '../mock/data';

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
 * device like photos, and sorted into categories on the device that added them.
 */
export function Files() {
  const vault = useVault();
  const { state, space } = vault;
  const { openDialog } = useUploads();
  const downloads = useDownloads();
  const { otherSpaceOpen } = useAccount();
  const toast = useToast();
  const [deleting, setDeleting] = useState<Photo | null>(null);
  const [moving, setMoving] = useState<Photo | null>(null);
  const [sorting, setSorting] = useState<Photo | null>(null);
  const [filing, setFiling] = useState<Photo | null>(null);
  const [shown, setShown] = useState<Shown>('all');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useFileView();
  const [hidden] = useDocumentPhotosView();

  const files = useMemo(
    () =>
      [...(state.files ?? [])]
        .filter((item) => !item.sharedAlbum)
        .sort((a, b) => b.takenAt.localeCompare(a.takenAt)),
    [state.files],
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
  // A choice emptied (its last file moved or deleted) falls back to All.
  const filter = choices.some(([choice]) => choice === shown) ? shown : 'all';
  const listed =
    filter === 'all' || filter === DOCUMENT_PHOTOS
      ? files
      : files.filter((item) => categoryOf(item, looks.get(item.id)) === filter);
  const label = (item: Photo) => categoryOf(item, looks.get(item.id));

  const run = (work: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(true);
    work().then(
      () => {
        setBusy(false);
        setDeleting(null);
        setMoving(null);
        setSorting(null);
        setFiling(null);
        toast.show(done);
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
    if (isViewOnly(item)) return items;
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
      icon: 'folder',
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
    items.push({
      label: 'Delete',
      icon: 'trash',
      danger: true,
      onSelect: () => {
        setDeleting(item);
      },
    });
    return items;
  };

  const upload = (
    <button type="button" className="btn btn--primary" onClick={openDialog}>
      <Icon name="upload" size={18} />
      Add files
    </button>
  );

  return (
    <div className="page">
      <PageHeader
        title="Files"
        subtitle={
          files.length > 0
            ? `${pluralize(files.length, 'file')} · ${formatBytes(total)}`
            : 'PDFs, documents and other files, encrypted like your photos'
        }
        actions={
          (files.length > 0 || pictures.length > 0) && (
            <>
              <ViewPicker choices={FILE_VIEW_CHOICES} value={view} onChange={setView} />
              {upload}
            </>
          )
        }
      />

      {files.length === 0 && pictures.length === 0 ? (
        <EmptyState icon="file" title="No files yet" action={upload}>
          Add PDFs, documents, spreadsheets and other files. They’re encrypted on this device before
          they’re uploaded. Videos can’t be added yet.
        </EmptyState>
      ) : (
        <>
          {choices.length > 2 && (
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
                    {month.photos.map((item) =>
                      view === 'grid' ? (
                        <FileTile
                          key={item.id}
                          item={item}
                          details={fileDetails(item, null)}
                          menu={menuFor(item)}
                        />
                      ) : (
                        <FileRow
                          key={item.id}
                          item={item}
                          details={fileDetails(item, filter === 'all' ? label(item) : null)}
                          menu={menuFor(item)}
                        />
                      ),
                    )}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}

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

      <Dialog
        open={deleting !== null}
        onClose={() => {
          setDeleting(null);
        }}
        title={`Delete ${deleting?.file?.name ?? 'this file'}?`}
        description={trashNote(1)}
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
