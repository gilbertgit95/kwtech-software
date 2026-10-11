'use client';

import {
  documentFileName,
  documentName,
  isDocumentFileName,
  prepareDocumentFile,
  STUDIO_DOCUMENT_FILE_MESSAGES,
  type StudioDocumentFile,
} from '../../domain/custom-document.js';
import type { StudioSize } from '../../domain/layout.js';
import { toPoints } from '../../domain/units.js';
import type { StudioDocument } from './document.js';

/** The largest saved document opened: 50 MB. Pictures are held inside it, so a few photos make it large. */
const DOCUMENT_FILE_BYTES_MAX = 50 * 1024 * 1024;

/**
 * A written document's pages, drawn by the editor, bound into a PDF that the
 * document screen prints like any other (`document.ts`).
 *
 * ⚠ THE PAGES ARE PICTURES, not text: the editor draws on a canvas and has no
 * PDF writer of its own. They are drawn at 300 dpi (the caller's pixel ratio),
 * which prints as sharp as text on an office printer; the cost is a larger
 * file, never seen, since it stays in memory.
 */
export async function makeCustomDocumentPdf(
  pages: readonly string[],
  sheet: StudioSize,
  name: string,
): Promise<StudioDocument> {
  if (pages.length === 0) throw new Error('The document has no pages to print.');
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  const width = toPoints(sheet.width);
  const height = toPoints(sheet.height);
  // In order, one at a time: each page is a large picture, and the order is the document's.
  for (const page of pages) {
    const image = await out.embedPng(page);
    out.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
  }
  const bytes = await out.save();
  return { name: `${documentName(name)}.pdf`, bytes, pages: pages.map(() => ({ ...sheet })) };
}

/** Save a written document to a file on this computer, the only place it is kept. */
export function downloadDocumentFile(file: StudioDocumentFile): void {
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = documentFileName(file.name);
  link.click();
  // Not at once: some browsers start the download after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Open a saved document. Throws a sentence for the person. */
export async function readDocumentFile(file: File): Promise<StudioDocumentFile> {
  if (!isDocumentFileName(file.name)) throw new Error(STUDIO_DOCUMENT_FILE_MESSAGES.not_a_document);
  if (file.size > DOCUMENT_FILE_BYTES_MAX) throw new Error(`“${file.name}” is too large to open here.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    // Not JSON: a file renamed to .kwdoc, or one cut short.
    throw new Error(STUDIO_DOCUMENT_FILE_MESSAGES.damaged);
  }
  const prepared = prepareDocumentFile(parsed);
  if ('refused' in prepared) throw new Error(STUDIO_DOCUMENT_FILE_MESSAGES[prepared.refused]);
  return prepared;
}

/** Read a chosen picture as a `data:` URL, the only way the editor and the saved file hold one. */
export function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read that picture.'));
    reader.onerror = () => reject(new Error(`“${file.name}” could not be read.`));
    reader.readAsDataURL(file);
  });
}

/** A picture's own size in pixels, to place it at its shape. */
export function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('That picture could not be opened.'));
    image.src = dataUrl;
  });
}
