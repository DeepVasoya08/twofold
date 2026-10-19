import { useRef, useState } from 'react';
import type { DragEvent } from 'react';

import { useUploads } from '../app/uploads';
import type { UploadItem } from '../app/uploads';
import { PHOTO_TYPES } from '../lib/photo-types';
import { STATUS_PROGRESS } from '../lib/upload-progress';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

import './upload-dialog.css';

function phase(item: UploadItem): string {
  switch (item.status) {
    case 'waiting':
      return 'Waiting';
    case 'encrypting':
      return 'Encrypting on this device';
    case 'uploading':
      return 'Uploading';
    case 'done':
      return 'Done';
    case 'failed':
      return item.error ?? 'Couldn’t upload this photo';
  }
}

interface UploadDialogProps {
  /** New uploads go into this album as well as the timeline. */
  albumId?: string | undefined;
}

/**
 * Picks photos and shows how their uploads are going. The uploads themselves run in
 * app/uploads.tsx, so closing this dialog leaves them going.
 */
export function UploadDialog({ albumId }: UploadDialogProps) {
  const { items, running, dialogOpen, closeDialog, addFiles, cancelWaiting } = useUploads();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = items.length > 0 && !running;
  const waiting = items.some((item) => item.status === 'waiting');

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files, albumId);
  };

  return (
    <Dialog
      open={dialogOpen}
      onClose={closeDialog}
      title="Add photos"
      description="Photos are encrypted on this device before they're uploaded. No one can see them unless you share them."
      size="md"
    >
      <div
        className={`dropzone${dragging ? ' is-dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={onDrop}
      >
        <span className="dropzone__icon">
          <Icon name="image-plus" size={28} />
        </span>
        <p className="dropzone__title">Drop photos here</p>
        <p className="dropzone__text">or</p>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => inputRef.current?.click()}
        >
          Choose from this device
        </button>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept={PHOTO_TYPES.join(',')}
          multiple
          tabIndex={-1}
          aria-label="Choose photos"
          onChange={(event) => {
            addFiles(event.currentTarget.files, albumId);
            event.currentTarget.value = '';
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="upload-list" aria-label="Uploads">
          {items.map((item) => (
            <li key={item.id} className="upload-item">
              {item.url ? (
                <img className="upload-item__thumb" src={item.url} alt="" loading="lazy" />
              ) : (
                <span className="upload-item__thumb" aria-hidden="true" />
              )}
              <div className="upload-item__body">
                <span className="upload-item__name">{item.name}</span>
                <div
                  className="progress"
                  role="progressbar"
                  aria-label={`${item.name}: ${phase(item)}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={STATUS_PROGRESS[item.status]}
                >
                  <span
                    className="progress__bar"
                    style={{ width: `${String(STATUS_PROGRESS[item.status])}%` }}
                  />
                </div>
                <span
                  className={`upload-item__phase${item.status === 'done' ? ' is-done' : ''}${item.status === 'failed' ? ' is-failed' : ''}`}
                >
                  <Icon
                    name={
                      item.status === 'done' ? 'check' : item.status === 'failed' ? 'x' : 'lock'
                    }
                    size={14}
                  />
                  {phase(item)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {running && (
        <p className="upload-note">
          You can close this and keep using Twofold. Keep this tab open until uploads finish.
        </p>
      )}

      <div className="dialog__actions">
        {waiting && (
          <button type="button" className="btn btn--ghost" onClick={cancelWaiting}>
            Cancel remaining
          </button>
        )}
        <button type="button" className="btn btn--primary" onClick={closeDialog}>
          {finished ? 'Done' : 'Close'}
        </button>
      </div>
    </Dialog>
  );
}
