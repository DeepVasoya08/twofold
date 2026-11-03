import { useEffect, useRef, useState } from 'react';

import { errorMessage } from '../app/account-ops';
import { useDownloads } from '../app/downloads';
import { paths } from '../app/routes';
import { useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { docxText, fileViewOf, readText } from '../lib/document-text';
import type { FileView } from '../lib/document-text';
import { currentPreviewTier } from '../lib/file-preview';
import type { PreviewTier } from '../lib/file-preview';
import { fileKindLabel, fileKindOf } from '../lib/file-types';
import { formatShortDay } from '../lib/format';
import { closePdf, drawPage, openPdf } from '../lib/pdf';
import type { PdfDocument } from '../lib/pdf';
import { formatBytes } from '../lib/storage-usage';

import './file-viewer.css';

/** What the viewer has made of the file so far. */
type Shown =
  | { stage: 'loading' }
  | { stage: 'failed'; message: string }
  | { stage: 'pdf'; bytes: Uint8Array<ArrayBuffer> }
  | { stage: 'text'; text: string; cut: boolean }
  | { stage: 'paragraphs'; paragraphs: string[] };

/** Widest a page or text column is drawn, in CSS pixels. */
const MAX_WIDTH = 880;

/**
 * Shows one file inside the app where it can: a PDF drawn page by page, text and Word
 * documents as plain text. The file is decrypted into memory only, and let go when the
 * viewer closes. Anything else can only be downloaded.
 */
export function FileViewer({ fileId }: { fileId: string }) {
  const { state, status, openFile } = useVault();
  const downloads = useDownloads();
  const item = state.files?.find((candidate) => candidate.id === fileId);
  const file = item?.file;
  const view: FileView = file ? fileViewOf(file.type, file.name) : 'none';
  // What was made of which file: another file shows as loading until its own arrives.
  const [result, setResult] = useState<{ fileId: string; shown: Shown } | null>(null);
  const shown: Shown = result?.fileId === fileId ? result.shown : { stage: 'loading' };

  useEffect(() => {
    if (view === 'none') return;
    let cancelled = false;
    openFile(fileId)
      .then(async ({ full }): Promise<Shown> => {
        if (view === 'pdf') return { stage: 'pdf', bytes: full };
        if (view === 'text') return { stage: 'text', ...readText(full) };
        return { stage: 'paragraphs', paragraphs: await docxText(full) };
      })
      .then(
        (next) => {
          if (!cancelled) setResult({ fileId, shown: next });
        },
        (error: unknown) => {
          if (!cancelled) {
            setResult({ fileId, shown: { stage: 'failed', message: errorMessage(error) } });
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [fileId, view, openFile]);

  if (!item || !file) {
    return (
      <div className="page">
        <PageHeader title="File" back={{ to: paths.files, label: 'Files' }} />
        <EmptyState icon="file" title={status === 'loading' ? 'Loading…' : 'File not found'}>
          {status === 'loading'
            ? 'Decrypting your files.'
            : 'This file isn’t in your vault anymore.'}
        </EmptyState>
      </div>
    );
  }

  const details = [
    fileKindLabel(fileKindOf(file.type, file.name)),
    ...(file.bytes === undefined ? [] : [formatBytes(file.bytes)]),
    formatShortDay(item.takenAt),
  ].join(' · ');

  return (
    <div className="page file-viewer">
      <PageHeader
        title={file.name}
        subtitle={details}
        back={{ to: paths.files, label: 'Files' }}
        actions={
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              downloads.start([item.id]);
            }}
          >
            <Icon name="download" size={18} />
            Download
          </button>
        }
      />
      {view === 'none' ? (
        <EmptyState icon="file" title="No preview for this kind of file">
          Download it to open it on this device.
        </EmptyState>
      ) : (
        <FileBody shown={shown} />
      )}
    </div>
  );
}

function FileBody({ shown }: { shown: Shown }) {
  switch (shown.stage) {
    case 'loading':
      return <p className="file-viewer__note">Decrypting on this device…</p>;
    case 'failed':
      return (
        <p className="file-viewer__note" role="alert">
          {shown.message} You can still download it.
        </p>
      );
    case 'pdf':
      return <PdfView bytes={shown.bytes} tier={currentPreviewTier()} />;
    case 'text':
      return (
        <>
          <pre className="file-viewer__text" aria-label="File text">
            {shown.text}
          </pre>
          {shown.cut && (
            <p className="file-viewer__note">
              This is the first part. Download it to see the rest.
            </p>
          )}
        </>
      );
    case 'paragraphs':
      return (
        <div className="file-viewer__doc" aria-label="Document text">
          {shown.paragraphs.map((paragraph, index) => (
            // Paragraphs never move, so their place is their key.
            <p key={index}>{paragraph || ' '}</p>
          ))}
        </div>
      );
  }
}

/**
 * A PDF, drawn by pdf.js. A fast device scrolls through every page, each drawn as it comes
 * near the screen; a light one shows a page at a time at a lower resolution.
 */
function PdfView({ bytes, tier }: { bytes: Uint8Array; tier: PreviewTier }) {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    let opened: PdfDocument | null = null;
    openPdf(bytes).then(
      (next) => {
        if (cancelled) {
          closePdf(next);
          return;
        }
        opened = next;
        setDoc(next);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      if (opened) closePdf(opened);
      setDoc(null);
    };
  }, [bytes]);

  if (failed) {
    return (
      <p className="file-viewer__note" role="alert">
        This PDF can’t be shown here. You can still download it.
      </p>
    );
  }
  if (!doc) return <p className="file-viewer__note">Opening the PDF…</p>;

  const count = doc.numPages;
  if (tier === 'light') {
    return (
      <div className="file-viewer__pages">
        <PdfPage doc={doc} number={page} pixelRatio={1} lazy={false} />
        <div className="file-viewer__pager">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={page <= 1}
            onClick={() => {
              setPage(page - 1);
            }}
          >
            <Icon name="chevron-left" size={18} />
            Previous
          </button>
          <span aria-live="polite">
            Page {String(page)} of {String(count)}
          </span>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={page >= count}
            onClick={() => {
              setPage(page + 1);
            }}
          >
            Next
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      </div>
    );
  }
  const pixelRatio = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio);
  return (
    <div className="file-viewer__pages">
      {Array.from({ length: count }, (_, index) => (
        <PdfPage key={index + 1} doc={doc} number={index + 1} pixelRatio={pixelRatio} lazy />
      ))}
    </div>
  );
}

function PdfPage({
  doc,
  number,
  pixelRatio,
  lazy,
}: {
  doc: PdfDocument;
  number: number;
  pixelRatio: number;
  /** Drawn only once it comes near the screen. */
  lazy: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(!lazy);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    if (!lazy || near || !frame.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: '800px 0px' },
    );
    observer.observe(frame.current);
    return () => {
      observer.disconnect();
    };
  }, [lazy, near]);

  useEffect(() => {
    const target = canvas.current;
    const box = frame.current;
    if (!near || !target || !box) return;
    const controller = new AbortController();
    setDrawn(false);
    const width = Math.min(MAX_WIDTH, box.clientWidth || MAX_WIDTH);
    drawPage(doc, number, target, width, pixelRatio, controller.signal).then(
      () => {
        if (!controller.signal.aborted) setDrawn(true);
      },
      () => undefined,
    );
    return () => {
      controller.abort();
    };
  }, [doc, number, pixelRatio, near]);

  return (
    <div ref={frame} className={`file-viewer__page${drawn ? ' is-drawn' : ''}`}>
      <canvas
        ref={canvas}
        className="file-viewer__canvas"
        role="img"
        aria-label={`Page ${String(number)}`}
      />
    </div>
  );
}
