/**
 * Dragging files and folders onto folders, on screens with a mouse. Only ids travel with a
 * drag, under types of this app's own, so a drop from elsewhere (a file from the desktop, a
 * link) is never taken for one.
 */
import type { DragEvent, HTMLAttributes } from 'react';

const ITEM = 'application/x-arcafold-item';
const FOLDER = 'application/x-arcafold-folder';

/** What is being dropped: a file (or photo) or a folder, by id. */
export type Dropped = { kind: 'item'; id: string } | { kind: 'folder'; id: string };

function startDrag(type: string, id: string) {
  return (event: DragEvent) => {
    event.dataTransfer.setData(type, id);
    event.dataTransfer.effectAllowed = 'move';
  };
}

/** Makes a file's row or tile draggable onto folders. */
export function dragProps(id: string, enabled = false): HTMLAttributes<HTMLElement> {
  return enabled ? { draggable: true, onDragStart: startDrag(ITEM, id) } : {};
}

/** Makes a folder draggable onto other folders. */
export function folderDragProps(id: string, enabled = false): HTMLAttributes<HTMLElement> {
  return enabled ? { draggable: true, onDragStart: startDrag(FOLDER, id) } : {};
}

/** Whether a drag carries something of ours. */
function ours(event: DragEvent): boolean {
  const types = event.dataTransfer.types;
  return types.includes(ITEM) || types.includes(FOLDER);
}

/** What a drop carried, if it was something of ours. */
export function dropped(event: DragEvent): Dropped | null {
  const item = event.dataTransfer.getData(ITEM);
  if (item) return { kind: 'item', id: item };
  const folder = event.dataTransfer.getData(FOLDER);
  return folder ? { kind: 'folder', id: folder } : null;
}

/**
 * Makes an element a place to drop files and folders. `setOver` says when something of ours
 * is held over it, to highlight it.
 */
export function dropProps(
  onDrop: (what: Dropped) => void,
  setOver: (over: boolean) => void,
): HTMLAttributes<HTMLElement> {
  return {
    onDragOver: (event) => {
      if (!ours(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setOver(true);
    },
    onDragLeave: () => {
      setOver(false);
    },
    onDrop: (event) => {
      setOver(false);
      const what = dropped(event);
      if (!what) return;
      event.preventDefault();
      onDrop(what);
    },
  };
}
