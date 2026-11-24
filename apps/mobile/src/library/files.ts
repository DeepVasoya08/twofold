import { CATEGORIES, categoryLabel } from '@arcafold/core/file-categories';
import type { Category } from '@arcafold/core/file-categories';
import { fileKindLabel, fileKindOf } from '@arcafold/core/file-types';
import { formatBytes } from '@arcafold/core/format-bytes';
import type { Photo } from '@arcafold/core/library/model';
import { groupByMonth } from '@arcafold/core/library/months';

/**
 * The Files tab: everything added that isn't a photo, by month like the web, with the
 * categories files were sorted into as filters.
 */

/** What the list shows: every file, or one category's. */
export type Shown = Category | 'all';

/**
 * Files in the open space: not photos, not ones in Recently deleted, and not ones here only
 * through an album shared with you (those show in the album).
 */
export function libraryFiles(items: readonly Photo[]): Photo[] {
  return items.filter(
    (item) => item.file !== undefined && item.deletedAt === undefined && !item.sharedAlbum,
  );
}

/** A file's category: the one it was sorted into, or Other until it is. */
export function fileCategory(item: Photo): Category {
  return item.file?.category ?? 'other';
}

/** The categories that have files, with how many, in the fixed order. */
export function categoryCounts(files: readonly Photo[]): [Category, number][] {
  const counts = new Map<Category, number>();
  for (const item of files) {
    const category = fileCategory(item);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return CATEGORIES.flatMap((category) => {
    const count = counts.get(category);
    return count ? [[category, count] as [Category, number]] : [];
  });
}

export type FileRow =
  | { kind: 'month'; key: string; label: string; count: number }
  | { kind: 'file'; key: string; item: Photo };

/** The files `shown` as list rows: each month's heading, then its files, newest first. */
export function fileRows(files: readonly Photo[], shown: Shown): FileRow[] {
  const picked = shown === 'all' ? files : files.filter((item) => fileCategory(item) === shown);
  return groupByMonth(picked).flatMap((month): FileRow[] => [
    { kind: 'month', key: month.key, label: month.label, count: month.photos.length },
    ...month.photos.map((item): FileRow => ({ kind: 'file', key: item.id, item })),
  ]);
}

export type FileGridRow =
  | { kind: 'month'; key: string; label: string; count: number }
  | { kind: 'files'; key: string; items: Photo[] };

/** The same rows for the grid view: each month's heading, then its files `across` a row. */
export function fileGridRows(rows: readonly FileRow[], across: number): FileGridRow[] {
  const out: FileGridRow[] = [];
  let open: Photo[] | null = null;
  for (const row of rows) {
    if (row.kind === 'month') {
      out.push(row);
      open = null;
      continue;
    }
    if (!open || open.length >= across) {
      open = [];
      out.push({ kind: 'files', key: `row-${row.key}`, items: open });
    }
    open.push(row.item);
  }
  return out;
}

const shortDay = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** "PDF · 1.2 MB · Apr 2 · Taxes", and who shared it when it isn't yours. */
export function fileDetails(item: Photo): string {
  const file = item.file;
  const category = fileCategory(item);
  return [
    file ? fileKindLabel(fileKindOf(file.type, file.name)) : 'File',
    ...(file?.bytes === undefined ? [] : [formatBytes(file.bytes)]),
    shortDay.format(new Date(item.takenAt)),
    ...(category === 'other' ? [] : [categoryLabel(category)]),
    ...(item.library === undefined ? [] : [`Shared by ${item.library}`]),
  ].join(' · ');
}

/** The few letters a file without a preview shows: its extension, or its kind. */
export function fileBadge(item: Photo): string {
  const name = item.file?.name ?? '';
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1) : '';
  if (extension.length > 0 && extension.length <= 4) return extension.toUpperCase();
  return fileKindLabel(fileKindOf(item.file?.type ?? '', name))
    .slice(0, 4)
    .toUpperCase();
}

/** Whether a file has a preview of its own to show (a PDF's first page). */
export function hasPreview(item: Photo): boolean {
  return item.file?.preview === true;
}
