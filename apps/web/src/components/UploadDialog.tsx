import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';

import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import { pluralize } from '../lib/format';
import type { Photo } from '../mock/data';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

import './upload-dialog.css';

interface UploadItem {
  id: string;
  name: string;
  /** In-memory object URL for the preview; never written to storage. */
  url: string;
  width: number;
  height: number;
  /** 0–100. Encrypting is the first half, uploading the second. */
  progress: number;
}

const TICK_MS = 90;

function readSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth || 1200, height: image.naturalHeight || 800 });
    };
    image.onerror = () => {
      resolve({ width: 1200, height: 800 });
    };
    image.src = url;
  });
}

function phase(progress: number): string {
  if (progress >= 100) return 'Done';
  if (progress >= 50) return 'Uploading';
  return 'Encrypting on this device';
}

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  albumId?: string | undefined;
}

/**
 * Upload flow on mock data: progress is simulated. Real uploads will encrypt each file with
 * packages/crypto before anything leaves the browser.
 */
export function UploadDialog({ open, onClose, albumId }: UploadDialogProps) {
  const { dispatch } = useVault();
  const toast = useToast();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const committed = useRef(false);
  const nextId = useRef(0);

  const running = items.some((item) => item.progress < 100);
  const finished = items.length > 0 && !running;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setItems((current) =>
        current.map((item, index) =>
          item.progress >= 100
            ? item
            : { ...item, progress: Math.min(100, item.progress + 4 + ((index * 3) % 5)) },
        ),
      );
    }, TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [running]);

  useEffect(() => {
    if (!finished || committed.current) return;
    committed.current = true;
    const now = new Date().toISOString();
    const photos: Photo[] = items.map((item) => ({
      id: item.id,
      src: item.url,
      width: item.width,
      height: item.height,
      takenAt: now,
      addedBy: 'me',
      favorite: false,
      albumIds: [],
    }));
    dispatch(albumId ? { type: 'add-photos', photos, albumId } : { type: 'add-photos', photos });
    toast.show(`${pluralize(photos.length, 'photo')} added to your vault`);
  }, [finished, items, albumId, dispatch, toast]);

  const addFiles = async (files: FileList | null) => {
    const images = [...(files ?? [])].filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return;
    committed.current = false;
    const added = await Promise.all(
      images.map(async (file) => {
        const url = URL.createObjectURL(file);
        const size = await readSize(url);
        nextId.current += 1;
        return {
          id: `upload-${String(Date.now())}-${String(nextId.current)}`,
          name: file.name,
          url,
          ...size,
          progress: 0,
        };
      }),
    );
    setItems((current) => [...current.filter((item) => item.progress < 100), ...added]);
  };

  const close = () => {
    // Previews of photos that never made it into the vault are released straight away.
    if (!committed.current) {
      for (const item of items) URL.revokeObjectURL(item.url);
    }
    setItems([]);
    committed.current = false;
    onClose();
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(event.dataTransfer.files);
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
          accept="image/*"
          multiple
          tabIndex={-1}
          aria-label="Choose photos"
          onChange={(event) => {
            void addFiles(event.currentTarget.files);
            event.currentTarget.value = '';
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="upload-list" aria-label="Uploads">
          {items.map((item) => (
            <li key={item.id} className="upload-item">
              <img className="upload-item__thumb" src={item.url} alt="" />
              <div className="upload-item__body">
                <span className="upload-item__name">{item.name}</span>
                <div
                  className="progress"
                  role="progressbar"
                  aria-label={`${item.name}: ${phase(item.progress)}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={item.progress}
                >
                  <span className="progress__bar" style={{ width: `${String(item.progress)}%` }} />
                </div>
                <span className={`upload-item__phase${item.progress >= 100 ? ' is-done' : ''}`}>
                  {item.progress >= 100 ? (
                    <Icon name="check" size={14} />
                  ) : (
                    <Icon name="lock" size={14} />
                  )}
                  {phase(item.progress)}
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
