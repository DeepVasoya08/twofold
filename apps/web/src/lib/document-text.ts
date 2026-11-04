import { fileExtension, fileKindOf } from '@arcafold/core/file-types';
import { listZip, readZipEntry } from './zip-reader';

/**
 * Reading what a text file or a Word document says, to show it as plain text in the app.
 * Nothing here renders HTML or runs anything: text is always shown as text.
 */

/** The most text shown in the app; longer files show this much and offer a download. */
export const TEXT_SHOWN_MAX = 1024 * 1024;

/** The largest Word document body read, unpacked. */
const DOCX_BODY_MAX = 32 * 1024 * 1024;

/** How a file shows inside the app. */
export type FileView = 'pdf' | 'text' | 'docx' | 'none';

/** How a file can be shown: PDFs drawn, text and Word as plain text, the rest not at all. */
export function fileViewOf(type: string, name: string): FileView {
  const kind = fileKindOf(type, name);
  if (kind === 'pdf') return 'pdf';
  if (kind === 'text') return 'text';
  if (fileExtension(name) === 'docx') return 'docx';
  return 'none';
}

/** Plain text read from bytes as UTF-8, cut at TEXT_SHOWN_MAX characters. */
export function readText(bytes: Uint8Array): { text: string; cut: boolean } {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (text.length <= TEXT_SHOWN_MAX) return { text, cut: false };
  return { text: text.slice(0, TEXT_SHOWN_MAX), cut: true };
}

/** The five named XML entities, and numeric ones. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (whole, code: string) => {
    switch (code) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
    }
    const value = code.startsWith('#x') ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isInteger(value) && value > 0 && value <= 0x10ffff
      ? String.fromCodePoint(value)
      : whole;
  });
}

/** One paragraph's runs: text, tabs and line breaks, in order. */
const RUN_PART = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>/g;

/**
 * The paragraphs of a Word document's body XML (word/document.xml), as plain text: runs of
 * text joined, tabs and line breaks kept. Only `w:p`, `w:t`, `w:tab` and `w:br` are read;
 * everything else (fields, drawings, comments) is skipped. The result is only ever shown
 * as text, never as markup.
 */
export function docxParagraphs(xml: string): string[] {
  const paragraphs: string[] = [];
  for (const match of xml.matchAll(/<w:p(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    const body = match[1] ?? '';
    let text = '';
    for (const part of body.matchAll(RUN_PART)) {
      if (part[1] !== undefined) text += decodeEntities(part[1]);
      else text += part[0].startsWith('<w:tab') ? '\t' : '\n';
    }
    paragraphs.push(text);
  }
  return paragraphs;
}

/** The text of a Word (.docx) document, by paragraph. Throws if it can't be read. */
export async function docxText(bytes: Uint8Array<ArrayBuffer>): Promise<string[]> {
  const zip = new Blob([bytes]);
  const entry = (await listZip(zip)).find((candidate) => candidate.name === 'word/document.xml');
  if (!entry) throw new Error('Not a Word document.');
  const body = await readZipEntry(zip, entry, DOCX_BODY_MAX);
  return docxParagraphs(new TextDecoder().decode(body));
}
