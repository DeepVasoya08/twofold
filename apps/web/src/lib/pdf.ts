import type * as PdfJsModule from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

/**
 * PDFs drawn with Mozilla's pdf.js, loaded only when a PDF is opened or previewed. The PDF
 * is read in a Web Worker from bytes already decrypted in memory; nothing is fetched except
 * pdf.js's own fonts and decoders from this site. pdf.js never runs a PDF's scripts (that
 * needs its separate sandbox, which isn't loaded), XFA forms aren't drawn, and pdf.js 6 has
 * no `eval` path (the content security policy forbids it anyway), so a PDF can't run code
 * in the app.
 */

/** Where pdf.js's fonts, character maps and decoders are served (see vite.config.ts). */
const RESOURCES = '/pdfjs/';

type PdfJs = typeof PdfJsModule;

let loading: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  loading ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return loading;
}

export type PdfDocument = PDFDocumentProxy;

/**
 * Opens a PDF from its bytes. The bytes are copied, since pdf.js takes over the buffer it is
 * given. Close it with `closePdf` when done, to free the worker's copy.
 */
export async function openPdf(bytes: Uint8Array): Promise<PdfDocument> {
  const pdfjs = await loadPdfJs();
  return pdfjs.getDocument({
    data: bytes.slice(),
    enableXfa: false,
    cMapUrl: `${RESOURCES}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${RESOURCES}standard_fonts/`,
    wasmUrl: `${RESOURCES}wasm/`,
  }).promise;
}

/** The scale that draws a page `cssWidth` CSS pixels wide, at `pixelRatio` device pixels each. */
export function pageScale(pageWidth: number, cssWidth: number, pixelRatio: number): number {
  if (pageWidth <= 0) return 1;
  return (cssWidth / pageWidth) * pixelRatio;
}

/**
 * Draws one page (counted from 1) onto `canvas`, `cssWidth` CSS pixels wide. Returns once
 * it's drawn; `signal` stops it part way.
 */
export async function drawPage(
  doc: PdfDocument,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  pixelRatio: number,
  signal?: AbortSignal,
): Promise<void> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: pageScale(base.width, cssWidth, pixelRatio) });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const task = page.render({ canvas, viewport });
  const stop = () => {
    task.cancel();
  };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    await task.promise;
  } finally {
    signal?.removeEventListener('abort', stop);
    page.cleanup();
  }
}

/** Lets a PDF go: its worker drops the decrypted bytes. */
export function closePdf(doc: PdfDocument): void {
  void doc.loadingTask.destroy();
}

/** The text of a PDF's first `maxPages` pages, as pdf.js reads it, one line per page. */
export async function pdfText(doc: PdfDocument, maxPages: number): Promise<string> {
  const pages: string[] = [];
  const last = Math.min(doc.numPages, maxPages);
  for (let number = 1; number <= last; number += 1) {
    const page = await doc.getPage(number);
    try {
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    } finally {
      page.cleanup();
    }
  }
  return pages.join('\n');
}
