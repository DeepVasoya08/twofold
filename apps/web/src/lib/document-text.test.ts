import { describe, expect, it } from 'vitest';

import { docxParagraphs, docxText, fileViewOf, readText, TEXT_SHOWN_MAX } from './document-text';
import { buildZip, zipEntry } from './zip';

const BODY = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Lease agreement</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Rent: </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>&#8377;25,000 &amp; deposit</w:t></w:r></w:p>
    <w:p/>
    <w:p><w:r><w:t>Tenant</w:t><w:tab/><w:t>Sam</w:t><w:br/><w:t>&lt;script&gt;alert(1)&lt;/script&gt;</w:t></w:r></w:p>
  </w:body>
</w:document>`;

describe('fileViewOf', () => {
  it.each([
    ['application/pdf', 'bill.pdf', 'pdf'],
    ['text/plain', 'notes.txt', 'text'],
    ['', 'data.csv', 'text'],
    ['', 'lease.docx', 'docx'],
    // Shown as its source text, never rendered.
    ['text/html', 'page.html', 'text'],
    ['image/svg+xml', 'logo.svg', 'none'],
    ['', 'budget.xlsx', 'none'],
  ] as const)('shows %s %s as %s', (type, name, view) => {
    expect(fileViewOf(type, name)).toBe(view);
  });
});

describe('readText', () => {
  it('reads UTF-8 and cuts very long text', () => {
    expect(readText(new TextEncoder().encode('héllo ₹'))).toEqual({ text: 'héllo ₹', cut: false });
    const long = readText(new Uint8Array(TEXT_SHOWN_MAX + 10).fill(97));
    expect(long.cut).toBe(true);
    expect(long.text).toHaveLength(TEXT_SHOWN_MAX);
  });
});

describe('docxParagraphs', () => {
  it('reads paragraphs, runs, tabs and breaks, and decodes entities as text', () => {
    expect(docxParagraphs(BODY)).toEqual([
      'Lease agreement',
      'Rent: ₹25,000 & deposit',
      '',
      'Tenant\tSam\n<script>alert(1)</script>',
    ]);
  });

  it('reads nothing from something that isn’t a document body', () => {
    expect(docxParagraphs('<html><p>hi</p></html>')).toEqual([]);
  });
});

describe('docxText', () => {
  it('reads the body out of a .docx file', async () => {
    const zip = buildZip([
      zipEntry('word/document.xml', new TextEncoder().encode(BODY), new Date()),
    ]);
    const paragraphs = await docxText(new Uint8Array(await zip.arrayBuffer()));
    expect(paragraphs[0]).toBe('Lease agreement');
  });

  it('refuses a zip that isn’t a Word document', async () => {
    const zip = buildZip([zipEntry('other.txt', new TextEncoder().encode('x'), new Date())]);
    await expect(docxText(new Uint8Array(await zip.arrayBuffer()))).rejects.toThrow(
      'Not a Word document.',
    );
  });
});
