import { useMemo, useState } from 'react';

import type { SpaceKeys } from '@arcafold/crypto';

import { useAccount } from '../app/account';
import { errorMessage } from '../app/account-ops';
import { useDownloads } from '../app/downloads';
import { Link } from '../app/router';
import { paths } from '../app/routes';
import { useToast } from '../app/toast';
import { useUploads } from '../app/uploads';
import { useFileView } from '../app/views';
import { isViewOnly, trashNote, useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { FileThumb } from '../components/FileIcon';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Menu';
import type { MenuItem } from '../components/Menu';
import { MoveSpaceDialog, moveLabel } from '../components/MoveSpaceDialog';
import { FILE_VIEW_CHOICES, ViewPicker } from '../components/ViewPicker';
import { CATEGORIES, categoryLabel } from '../lib/file-sort/categories';
import type { Category } from '../lib/file-sort/categories';
import { fileKindLabel, fileKindOf } from '../lib/file-types';
import { formatShortDay, groupByMonth, pluralize } from '../lib/format';
import { formatBytes } from '../lib/storage-usage';
import type { Photo } from '../mock/data';

import './files.css';
import './gallery.css';

/** A file's category: the one it was sorted into, or Other until it is. */
export function categoryOf(item: Photo): Category {
  return item.file?.category ?? 'other';
}

/** Which categories to offer as filters: those with files, in the fixed order. */
export function categoryCounts(files: readonly Photo[]): [Category, number][] {
  const counts = new Map<Category, number>();
  for (const item of files) counts.set(categoryOf(item), (counts.get(categoryOf(item)) ?? 0) + 1);
  return CATEGORIES.flatMap((category) => {
    const count = counts.get(category);
    return count ? [[category, count] as [Category, number]] : [];
  });
}

/** A file's details line: "PDF · 1.2 MB · 2 Nov", with its category and whose library. */
function detailsOf(item: Photo, withCategory: boolean): string {
  const file = item.file;
  const parts = [
    file ? fileKindLabel(fileKindOf(file.type, file.name)) : 'File',
    ...(file?.bytes === undefined ? [] : [formatBytes(file.bytes)]),
    formatShortDay(item.takenAt),
    ...(withCategory && file?.category ? [categoryLabel(file.category)] : []),
    ...(item.library === undefined ? [] : [`Shared by ${item.library}`]),
  ];
  return parts.join(' · ');
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
  const [shown, setShown] = useState<Category | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useFileView();

  const files = useMemo(
    () =>
      [...(state.files ?? [])]
        .filter((item) => !item.sharedAlbum)
        .sort((a, b) => b.takenAt.localeCompare(a.takenAt)),
    [state.files],
  );
  const total = files.reduce((sum, item) => sum + (item.size ?? 0), 0);
  const counts = useMemo(() => categoryCounts(files), [files]);
  // A category emptied (its last file moved or deleted) falls back to All.
  const filter = counts.some(([category]) => category === shown) ? shown : 'all';
  const listed = filter === 'all' ? files : files.filter((item) => categoryOf(item) === filter);

  const run = (work: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(true);
    work().then(
      () => {
        setBusy(false);
        setDeleting(null);
        setMoving(null);
        setSorting(null);
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
          files.length > 0 && (
            <>
              <ViewPicker choices={FILE_VIEW_CHOICES} value={view} onChange={setView} />
              {upload}
            </>
          )
        }
      />

      {files.length === 0 ? (
        <EmptyState icon="file" title="No files yet" action={upload}>
          Add PDFs, documents, spreadsheets and other files. They’re encrypted on this device before
          they’re uploaded. Videos can’t be added yet.
        </EmptyState>
      ) : (
        <>
          {counts.length > 1 && (
            <div className="file-categories" role="group" aria-label="Show category">
              {[['all', files.length] as const, ...counts].map(([category, count]) => (
                <button
                  key={category}
                  type="button"
                  className="file-categories__option"
                  aria-pressed={filter === category}
                  onClick={() => {
                    setShown(category);
                  }}
                >
                  {category === 'all' ? 'All' : categoryLabel(category)}
                  <span className="file-categories__count">{count}</span>
                </button>
              ))}
            </div>
          )}
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
                        details={detailsOf(item, false)}
                        menu={menuFor(item)}
                      />
                    ) : (
                      <FileRow
                        key={item.id}
                        item={item}
                        details={detailsOf(item, filter === 'all')}
                        menu={menuFor(item)}
                      />
                    ),
                  )}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      <CategoryDialog
        file={sorting}
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
  busy,
  onClose,
  onChoose,
}: {
  file: Photo | null;
  busy: boolean;
  onClose: () => void;
  onChoose: (category: Category) => void;
}) {
  const [picked, setPicked] = useState<{ fileId: string; category: Category } | null>(null);
  const current = file ? categoryOf(file) : 'other';
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

/** A file as a row: its picture, name and details, and its menu. */
function FileRow({ item, details, menu }: { item: Photo; details: string; menu: MenuItem[] }) {
  const name = item.file?.name ?? 'File';
  return (
    <li className="file-row">
      <Link to={paths.file(item.id)} className="file-row__main" aria-label={`Open ${name}`}>
        <FileThumb item={item} />
        <span className="file-row__text">
          <span className="file-row__name">{name}</span>
          <span className="file-row__meta">{details}</span>
        </span>
      </Link>
      <Menu
        label={`More for ${name}`}
        items={menu}
        className="file-row__menu"
        icon="more-vertical"
      />
    </li>
  );
}

/** A file as a tile: a big picture (a PDF's first page, or its icon) with its name below. */
function FileTile({ item, details, menu }: { item: Photo; details: string; menu: MenuItem[] }) {
  const name = item.file?.name ?? 'File';
  return (
    <li className="file-tile">
      <Link to={paths.file(item.id)} className="file-tile__main" aria-label={`Open ${name}`}>
        <span className="file-tile__picture">
          <FileThumb item={item} size="lg" />
        </span>
        <span className="file-tile__name">{name}</span>
        <span className="file-tile__meta">{details}</span>
      </Link>
      <Menu label={`More for ${name}`} items={menu} className="file-tile__menu" icon="more" />
    </li>
  );
}
