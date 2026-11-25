import { describe, expect, it } from 'vitest';

import type { FolderEdit } from '../records';
import { applyFolderEdit, changesFolders, sharedSubtree } from './folder-edits';
import type { SharedFolderState } from './folder-edits';

/** Trip (shared) > Days > Day 1, with a file in Days and a photo in Trip. */
function trip(): SharedFolderState {
  return {
    root: 'trip',
    folders: new Map([
      ['days', { name: 'Days', parent: 'trip' }],
      ['day1', { name: 'Day 1', parent: 'days' }],
    ]),
    files: new Map<string, { folder: string; name?: string }>([
      ['plan', { folder: 'days', name: 'plan.pdf' }],
      ['beach', { folder: 'trip' }],
      ['ticket', { folder: 'day1', name: 'ticket.pdf' }],
    ]),
  };
}

const at = '2026-11-25T10:00:00.000Z';

describe('applyFolderEdit', () => {
  it('makes a folder inside the shared folder, with a new id', () => {
    const state = trip();
    const make = (id: string, parent: string): FolderEdit => ({
      v: 1,
      op: 'make-folder',
      id,
      name: 'Food',
      parent,
    });
    expect(applyFolderEdit(state, make('food', 'day1'))).toBe(true);
    expect(state.folders.get('food')).toEqual({ name: 'Food', parent: 'day1' });
    // Not twice, not over the shared folder or a file, and not outside it.
    expect(applyFolderEdit(state, make('food', 'trip'))).toBe(false);
    expect(applyFolderEdit(state, make('trip', 'days'))).toBe(false);
    expect(applyFolderEdit(state, make('plan', 'days'))).toBe(false);
    expect(applyFolderEdit(state, make('other', 'elsewhere'))).toBe(false);
  });

  it('renames and moves folders inside it, but never the shared folder', () => {
    const state = trip();
    expect(applyFolderEdit(state, { v: 1, op: 'rename-folder', id: 'days', name: 'By day' })).toBe(
      true,
    );
    expect(state.folders.get('days')?.name).toBe('By day');
    expect(applyFolderEdit(state, { v: 1, op: 'rename-folder', id: 'trip', name: 'Mine' })).toBe(
      false,
    );
    expect(applyFolderEdit(state, { v: 1, op: 'move-folder', id: 'day1', parent: 'trip' })).toBe(
      true,
    );
    expect(state.folders.get('day1')?.parent).toBe('trip');
    expect(applyFolderEdit(state, { v: 1, op: 'move-folder', id: 'trip', parent: 'days' })).toBe(
      false,
    );
  });

  it('keeps a folder from going inside itself or out of the shared folder', () => {
    const state = trip();
    expect(applyFolderEdit(state, { v: 1, op: 'move-folder', id: 'days', parent: 'day1' })).toBe(
      false,
    );
    expect(applyFolderEdit(state, { v: 1, op: 'move-folder', id: 'days', parent: 'days' })).toBe(
      false,
    );
    expect(applyFolderEdit(state, { v: 1, op: 'move-folder', id: 'days', parent: 'home' })).toBe(
      false,
    );
    expect(state.folders.get('days')?.parent).toBe('trip');
  });

  it('deletes a folder with everything inside it', () => {
    const state = trip();
    expect(applyFolderEdit(state, { v: 1, op: 'delete-folder', id: 'days', at })).toBe(true);
    expect([...state.folders.keys()]).toEqual([]);
    expect([...state.files.keys()]).toEqual(['beach']);
    expect(applyFolderEdit(state, { v: 1, op: 'delete-folder', id: 'trip', at })).toBe(false);
  });

  it('renames only files, and moves and deletes files inside it', () => {
    const state = trip();
    expect(
      applyFolderEdit(state, { v: 1, op: 'rename-file', file: 'plan', name: 'Plan.pdf' }),
    ).toBe(true);
    expect(state.files.get('plan')?.name).toBe('Plan.pdf');
    // A photo has no name to change.
    expect(applyFolderEdit(state, { v: 1, op: 'rename-file', file: 'beach', name: 'x.jpg' })).toBe(
      false,
    );
    expect(applyFolderEdit(state, { v: 1, op: 'move-file', file: 'plan', folder: 'day1' })).toBe(
      true,
    );
    expect(state.files.get('plan')?.folder).toBe('day1');
    expect(applyFolderEdit(state, { v: 1, op: 'move-file', file: 'plan', folder: 'home' })).toBe(
      false,
    );
    expect(applyFolderEdit(state, { v: 1, op: 'move-file', file: 'gone', folder: 'trip' })).toBe(
      false,
    );
    expect(applyFolderEdit(state, { v: 1, op: 'delete-file', file: 'plan', at })).toBe(true);
    expect(applyFolderEdit(state, { v: 1, op: 'delete-file', file: 'plan', at })).toBe(false);
  });

  it('applies changes in order, so a later one can use a folder an earlier one made', () => {
    const state = trip();
    const edits: FolderEdit[] = [
      { v: 1, op: 'make-folder', id: 'food', name: 'Food', parent: 'trip' },
      { v: 1, op: 'move-file', file: 'beach', folder: 'food' },
      { v: 1, op: 'move-folder', id: 'days', parent: 'food' },
    ];
    expect(edits.map((edit) => applyFolderEdit(state, edit))).toEqual([true, true, true]);
    expect(sharedSubtree(state, 'food')).toEqual(new Set(['food', 'days', 'day1']));
  });
});

describe('changesFolders', () => {
  it('picks out changes to folders alone', () => {
    expect(changesFolders({ v: 1, op: 'make-folder', id: 'a', name: 'A', parent: 'r' })).toBe(true);
    expect(changesFolders({ v: 1, op: 'delete-folder', id: 'a', at })).toBe(false);
    expect(changesFolders({ v: 1, op: 'move-file', file: 'f', folder: 'a' })).toBe(false);
  });
});
