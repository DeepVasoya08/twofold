import type { TimelineRow } from './timeline';

/**
 * How photo grids are laid out on this phone, as the web's View buttons: square tiles four
 * across, smaller squares six across, or rows of photos each in its own shape.
 */
export type PhotoView = 'grid' | 'compact' | 'uncropped';

export const PHOTO_VIEWS: readonly PhotoView[] = ['grid', 'compact', 'uncropped'];

/** Tiles across for each square view. */
export const VIEW_COLUMNS: Record<Exclude<PhotoView, 'uncropped'>, number> = {
  grid: 4,
  compact: 6,
};

/** The height the uncropped view aims for before rows are stretched to the full width. */
export const UNCROPPED_ROW = 150;

/** A row of tiles as drawn: each tile's width, and the row's height. */
export interface LaidRow {
  kind: 'tiles';
  key: string;
  photoIds: string[];
  widths: number[];
  height: number;
}

export type LaidOutRow = Extract<TimelineRow, { kind: 'month' }> | LaidRow;

/**
 * Lays grid rows out for a view and screen width: the photos between month headings are
 * regrouped into rows of the view's shape, in the same order, so callers build rows once.
 * `aspect` gives a photo's width over its height (1 when unknown).
 */
export function layOut(
  rows: readonly TimelineRow[],
  view: PhotoView,
  width: number,
  gap: number,
  aspect: (photoId: string) => number,
): LaidOutRow[] {
  const out: LaidOutRow[] = [];
  let run: string[] = [];
  let runKey = '';
  const flush = () => {
    if (run.length === 0) return;
    out.push(
      ...(view === 'uncropped'
        ? justify(run, runKey, width, gap, aspect)
        : squares(run, runKey, VIEW_COLUMNS[view], width, gap)),
    );
    run = [];
  };
  for (const row of rows) {
    if (row.kind === 'month') {
      flush();
      out.push(row);
    } else {
      if (run.length === 0) runKey = row.key;
      run.push(...row.photoIds);
    }
  }
  flush();
  return out;
}

function squares(
  photoIds: readonly string[],
  key: string,
  columns: number,
  width: number,
  gap: number,
): LaidRow[] {
  const size = Math.floor((width - gap * (columns - 1)) / columns);
  const rows: LaidRow[] = [];
  for (let start = 0; start < photoIds.length; start += columns) {
    const ids = photoIds.slice(start, start + columns);
    rows.push({
      kind: 'tiles',
      key: `${key}/${String(start)}`,
      photoIds: ids,
      widths: ids.map(() => size),
      height: size,
    });
  }
  return rows;
}

/**
 * Rows of even height where every photo keeps its shape: photos join a row until it's at
 * least as wide as the screen at the aimed-for height, then the row is scaled to fit exactly.
 * The last row keeps the aimed-for height rather than stretching a photo or two across.
 */
function justify(
  photoIds: readonly string[],
  key: string,
  width: number,
  gap: number,
  aspect: (photoId: string) => number,
): LaidRow[] {
  const rows: LaidRow[] = [];
  let ids: string[] = [];
  let shapes: number[] = [];
  let start = 0;
  const finish = (last: boolean) => {
    const room = width - gap * (ids.length - 1);
    const total = shapes.reduce((sum, shape) => sum + shape, 0);
    const height = last ? Math.min(UNCROPPED_ROW, room / total) : room / total;
    const widths = shapes.map((shape) => Math.floor(shape * height));
    if (!last) {
      // Rounding down leaves a few pixels; the last tile takes them so the row ends flush.
      const used = widths.reduce((sum, each) => sum + each, 0);
      widths[widths.length - 1] = (widths[widths.length - 1] ?? 0) + Math.max(0, room - used);
    }
    rows.push({
      kind: 'tiles',
      key: `${key}/${String(start)}`,
      photoIds: ids,
      widths,
      height: Math.floor(height),
    });
  };
  photoIds.forEach((photoId, index) => {
    ids.push(photoId);
    shapes.push(aspect(photoId));
    const total = shapes.reduce((sum, shape) => sum + shape, 0);
    if (total * UNCROPPED_ROW + gap * (ids.length - 1) >= width) {
      finish(false);
      ids = [];
      shapes = [];
      start = index + 1;
    }
  });
  if (ids.length > 0) finish(true);
  return rows;
}
