import { useRef, useState } from 'react';
import type { DragEvent } from 'react';

import { FormError, errorMessage } from '../app/account-ops';
import type { NewPhoto } from '../app/space-store';
import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import { pluralize } from '../lib/format';
import { PHOTO_TYPES, PHOTO_TYPES_TEXT, isPhotoType } from '../lib/photo-types';
import { makeThumbnail } from '../lib/thumbnail';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

import './upload-dialog.css';

type Stage = 'waiting' | 'encrypting' | 'uploading' | 'done' | 'failed';

interface UploadItem {
  id: number;
  name: string;
  /** In-memory object URL for the preview; never written to storage. */
  url: string;
  stage: Stage;
  error?: string;
}

const PROGRESS: Record<Stage, number> = {
  waiting: 0,
  encrypting: 25,
  uploading: 60,
  done: 100,
  failed: 100,
};

function phase(item: UploadItem): string {
  switch (item.stage) {
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

const isRunning = (item: UploadItem) =>
  item.stage === 'waiting' || item.stage === 'encrypting' || item.stage === 'uploading';

/** Reads a file into what the vault stores: the original bytes and a JPEG preview. */
async function preparePhoto(file: File): Promise<NewPhoto> {
  const thumbnail = await makeThumbnail(file);
  if (!thumbnail) throw new FormError('Twofold can’t read this image.');
  return {
    thumb: thumbnail.bytes,
    full: new Uint8Array(await file.arrayBuffer()),
    type: file.type,
    width: thumbnail.width,
    height: thumbnail.height,
    takenAt: new Date().toISOString(),
  };
}

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  albumId?: string | undefined;
}

/**
 * Encrypts each photo on this device, then uploads the ciphertext, one photo at a time.
 * Cancelling stops the photos that haven't started yet.
 */
export function UploadDialog({ open, onClose, albumId }: UploadDialogProps) {
  const { upload } = useVault();
  const toast = useToast();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queue = useRef<{ id: number; file: File }[]>([]);
  const busy = useRef(false);
  const nextId = useRef(0);

  const running = items.some(isRunning);
  const finished = items.length > 0 && !running;

  const setStage = (id: number, stage: Stage, error?: string) => {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        return error === undefined ? { ...item, stage } : { ...item, stage, error };
      }),
    );
  };

  const pump = async () => {
    if (busy.current) return;
    busy.current = true;
    let added = 0;
    for (let job = queue.current.shift(); job; job = queue.current.shift()) {
      const { id, file } = job;
      try {
        setStage(id, 'encrypting');
        await upload(await preparePhoto(file), albumId, (stage) => {
          setStage(id, stage);
        });
        setStage(id, 'done');
        added += 1;
      } catch (error) {
        setStage(id, 'failed', errorMessage(error));
      }
    }
    busy.current = false;
    if (added > 0) toast.show(`${pluralize(added, 'photo')} added to your vault`);
  };

  const addFiles = (files: FileList | null) => {
    const images = [...(files ?? [])].filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return;
    const added = images.map((file): UploadItem => {
      nextId.current += 1;
      // Other image formats (SVG, for one) are shown as refused and never read.
      if (!isPhotoType(file.type)) {
        return {
          id: nextId.current,
          name: file.name,
          url: '',
          stage: 'failed',
          error: `Twofold takes ${PHOTO_TYPES_TEXT} photos.`,
        };
      }
      queue.current.push({ id: nextId.current, file });
      return {
        id: nextId.current,
        name: file.name,
        url: URL.createObjectURL(file),
        stage: 'waiting',
      };
    });
    setItems((current) => [...current, ...added]);
    void pump();
  };

  const close = () => {
    queue.current = [];
    for (const item of items) if (item.url) URL.revokeObjectURL(item.url);
    setItems([]);
    onClose();
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
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
            addFiles(event.currentTarget.files);
            event.currentTarget.value = '';
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="upload-list" aria-label="Uploads">
          {items.map((item) => (
            <li key={item.id} className="upload-item">
              {item.url ? (
                <img className="upload-item__thumb" src={item.url} alt="" />
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
                  aria-valuenow={PROGRESS[item.stage]}
                >
                  <span
                    className="progress__bar"
                    style={{ width: `${String(PROGRESS[item.stage])}%` }}
                  />
                </div>
                <span
                  className={`upload-item__phase${item.stage === 'done' ? ' is-done' : ''}${item.stage === 'failed' ? ' is-failed' : ''}`}
                >
                  <Icon
                    name={item.stage === 'done' ? 'check' : item.stage === 'failed' ? 'x' : 'lock'}
                    size={14}
                  />
                  {phase(item)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="dialog__actions">
        <button
          type="button"
          className={`btn ${running ? 'btn--ghost' : 'btn--primary'}`}
          onClick={close}
        >
          {running ? 'Cancel' : finished ? 'Done' : 'Close'}
        </button>
      </div>
    </Dialog>
  );
}
