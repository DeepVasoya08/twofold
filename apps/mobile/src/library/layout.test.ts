import { describe, expect, it } from 'vitest';

import { UNCROPPED_ROW, layOut } from './layout';
import type { LaidRow } from './layout';
import type { TimelineRow } from './timeline';

const month = (key: string, count: number): TimelineRow => ({
  kind: 'month',
  key,
  label: key,
  count,
});
const tiles = (key: string, photoIds: string[]): TimelineRow => ({ kind: 'tiles', key, photoIds });
const ids = (n: number, prefix = 'p') =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i)}`);
const tileRows = (rows: ReturnType<typeof layOut>) =>
  rows.filter((row): row is LaidRow => row.kind === 'tiles');

describe('layOut', () => {
  const rows = [
    month('nov', 7),
    tiles('nov/0', ids(4)),
    tiles('nov/4', ids(3, 'q')),
    month('oct', 1),
    tiles('oct/0', ['r']),
  ];

  it('keeps four square tiles across for the grid', () => {
    const laid = layOut(rows, 'grid', 406, 2, () => 1);
    expect(laid.map((row) => row.kind)).toEqual(['month', 'tiles', 'tiles', 'month', 'tiles']);
    expect(tileRows(laid)[0]?.widths).toEqual([100, 100, 100, 100]);
    expect(tileRows(laid)[0]?.height).toBe(100);
  });

  it('regroups a month six across for compact, never mixing months', () => {
    const laid = tileRows(layOut(rows, 'compact', 410, 2, () => 1));
    expect(laid.map((row) => row.photoIds.length)).toEqual([6, 1, 1]);
    expect(laid[0]?.photoIds).toEqual(['p0', 'p1', 'p2', 'p3', 'q0', 'q1']);
    expect(laid[2]?.photoIds).toEqual(['r']);
  });

  it('fills uncropped rows exactly, each photo in its own shape', () => {
    const shapes: Record<string, number> = {
      p0: 1.5,
      p1: 0.75,
      p2: 1.5,
      p3: 1,
      q0: 3,
      q1: 1,
      q2: 1,
    };
    const laid = tileRows(layOut(rows.slice(0, 3), 'uncropped', 400, 2, (id) => shapes[id] ?? 1));
    const first = laid[0];
    const used = first.widths.reduce((sum, each) => sum + each, 0) + 2 * (first.widths.length - 1);
    expect(used).toBe(400);
    expect(first.height).toBeLessThanOrEqual(UNCROPPED_ROW);
    expect(first.height).toBeGreaterThan(UNCROPPED_ROW / 2);
    // Every photo is shown once, in order.
    expect(laid.flatMap((row) => row.photoIds)).toEqual([...ids(4), ...ids(3, 'q')]);
  });

  it("doesn't stretch a short last row", () => {
    const laid = tileRows(layOut([tiles('a', ['x'])], 'uncropped', 400, 2, () => 1));
    expect(laid[0]?.height).toBe(UNCROPPED_ROW);
    expect(laid[0]?.widths).toEqual([UNCROPPED_ROW]);
  });
});
