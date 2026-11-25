import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { childFolders, folderPath } from '@arcafold/core/library/folders';
import type { Folder } from '@arcafold/core/library/model';
import { MAX_FOLDER_NAME } from '@arcafold/core/records';
import { errorMessage } from '@arcafold/core/errors';
import { Dialog } from './Dialog';
import { TextField } from './Field';
import { Icon } from './Icon';

import './folders.css';

/**
 * Asks for a folder's name, to make a new folder or rename one. `onSave` does the work;
 * what it throws shows under the field.
 */
export function FolderNameDialog({
  open,
  title,
  action,
  initial = '',
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  /** The button's label: "Create" or "Save". */
  action: string;
  initial?: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {/* Remounted on every opening, so it starts from `initial`. */}
      {open && <NameForm action={action} initial={initial} onClose={onClose} onSave={onSave} />}
    </Dialog>
  );
}

function NameForm({
  action,
  initial,
  onClose,
  onSave,
}: {
  action: string;
  initial: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    if (name.trim() === initial.trim() && initial !== '') {
      onClose();
      return;
    }
    setBusy(true);
    onSave(name).then(
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
    <form className="form" onSubmit={submit} noValidate>
      <TextField
        label="Folder name"
        autoFocus
        value={name}
        maxLength={MAX_FOLDER_NAME}
        onChange={(event) => {
          setName(event.currentTarget.value);
          setError(null);
        }}
        error={error}
      />
      <div className="dialog__actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
          {action}
        </button>
      </div>
    </form>
  );
}

/**
 * Picks where to move files or a folder: the top of Files or any folder, opened one level at a
 * time. `blocked` folders (a folder being moved, and those inside it) can't be chosen or opened.
 */
export function FolderPicker({
  open,
  title,
  folders,
  start,
  blocked,
  busy,
  onClose,
  onPick,
  onCreate,
}: {
  open: boolean;
  title: string;
  folders: readonly Folder[];
  /** The folder to start in (where the things being moved are now), or null for the top. */
  start: string | null;
  blocked?: ReadonlySet<string>;
  busy: boolean;
  onClose: () => void;
  /** The chosen folder, or null for the top of Files. */
  onPick: (folderId: string | null) => void;
  /** Makes a folder inside the one showing, and returns it. */
  onCreate: (name: string, parentId: string | null) => Promise<Folder>;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {open && (
        <PickerBody
          folders={folders}
          start={start}
          blocked={blocked ?? new Set()}
          busy={busy}
          onClose={onClose}
          onPick={onPick}
          onCreate={onCreate}
        />
      )}
    </Dialog>
  );
}

function PickerBody({
  folders,
  start,
  blocked,
  busy,
  onClose,
  onPick,
  onCreate,
}: {
  folders: readonly Folder[];
  start: string | null;
  blocked: ReadonlySet<string>;
  busy: boolean;
  onClose: () => void;
  onPick: (folderId: string | null) => void;
  onCreate: (name: string, parentId: string | null) => Promise<Folder>;
}) {
  const [at, setAt] = useState<string | null>(start !== null && blocked.has(start) ? null : start);
  const [naming, setNaming] = useState(false);
  const path = at === null ? [] : folderPath(folders, at);
  const here = path.at(-1) ?? null;
  const children = childFolders(folders, here?.id ?? null);

  return (
    <div className="folder-picker">
      <nav className="folder-picker__path" aria-label="Where">
        <button
          type="button"
          className="folder-picker__crumb"
          aria-current={here === null ? 'location' : undefined}
          onClick={() => {
            setAt(null);
          }}
        >
          Files
        </button>
        {path.map((folder) => (
          <span key={folder.id} className="folder-picker__step">
            <Icon name="chevron-right" size={14} />
            <button
              type="button"
              className="folder-picker__crumb"
              aria-current={folder.id === here?.id ? 'location' : undefined}
              onClick={() => {
                setAt(folder.id);
              }}
            >
              {folder.name}
            </button>
          </span>
        ))}
      </nav>
      <ul className="folder-picker__list" aria-label="Folders">
        {children.length === 0 && !naming && (
          <li className="folder-picker__empty">No folders in here yet.</li>
        )}
        {children.map((folder) => {
          const disabled = blocked.has(folder.id);
          return (
            <li key={folder.id}>
              <button
                type="button"
                className="folder-picker__item"
                disabled={disabled}
                onClick={() => {
                  setAt(folder.id);
                }}
              >
                <span className="folder-picker__icon" aria-hidden="true" />
                <span className="folder-picker__name">{folder.name}</span>
                <Icon name="chevron-right" size={16} />
              </button>
            </li>
          );
        })}
      </ul>
      {naming ? (
        <InlineName
          onCancel={() => {
            setNaming(false);
          }}
          onSave={async (name) => {
            const folder = await onCreate(name, here?.id ?? null);
            setNaming(false);
            setAt(folder.id);
          }}
        />
      ) : (
        <button
          type="button"
          className="btn btn--ghost folder-picker__new"
          onClick={() => {
            setNaming(true);
          }}
        >
          <Icon name="plus" size={16} />
          New folder
        </button>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || naming}
          aria-busy={busy}
          onClick={() => {
            onPick(here?.id ?? null);
          }}
        >
          {here ? `Move to “${here.name}”` : 'Move to Files'}
        </button>
      </div>
    </div>
  );
}

function InlineName({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    onSave(name).then(
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
    <form className="folder-picker__naming" onSubmit={submit} noValidate>
      <TextField
        label="New folder name"
        autoFocus
        value={name}
        maxLength={MAX_FOLDER_NAME}
        onChange={(event) => {
          setName(event.currentTarget.value);
          setError(null);
        }}
        error={error}
      />
      <div className="folder-picker__naming-actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
          Create
        </button>
      </div>
    </form>
  );
}
