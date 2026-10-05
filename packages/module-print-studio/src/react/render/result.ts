'use client';

import type { StudioCalibration } from '../../domain/calibration.js';
import type { StudioPageFill } from '../../domain/fill.js';
import { type StudioLayoutSpec, type StudioSize, sheetSize } from '../../domain/layout.js';
import { STUDIO_RENDER_DPI, toMm, toPoints } from '../../domain/units.js';
import type { StudioFrames, StudioPhotoEdit } from '../view/work.js';
import { canvasToJpeg, drawSheet, scratchCanvas, sheetPixels } from './draw-sheet.js';
import type { StudioPhoto } from './photos.js';

/**
 * The result of a print: a PDF at the paper's exact size, held IN MEMORY.
 *
 * ⚠ IT IS A `Blob` IN THIS TAB AND NOTHING ELSE. It is not uploaded and not
 * written to any browser storage; it goes when the person presses Done or
 * closes the page, and reaches the disk only if they press Download
 * (PRINT-STUDIO-PLAN decision 8).
 */
export interface StudioResult {
  pdf: Blob;
  /** Each sheet as an image, for the browser's own print dialog. Empty for a document result. */
  sheets: Blob[];
  /** The sheet as oriented, in units. */
  sheet: StudioSize;
  /** Sheets in the layout, before copies. */
  pages: number;
  copies: number;
}

export interface LayoutResultInput {
  spec: StudioLayoutSpec;
  pages: readonly StudioPageFill[];
  frames: StudioFrames;
  photos: ReadonlyMap<string, StudioPhoto>;
  edits: ReadonlyMap<string, StudioPhotoEdit>;
  calibration: StudioCalibration;
  copies: number;
  /** Called as each sheet is drawn, so a long job can say where it is. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Draw every sheet at 300 dpi and bind them into a PDF whose pages are the
 * paper's exact size.
 *
 * ⚠ ONE SHEET AT A TIME. Each is tens of megabytes as pixels; it is drawn,
 * compressed and let go before the next begins, so the peak is one sheet and
 * not the whole job.
 *
 * Copies are repeated PAGES: the image is embedded once and drawn on each, so
 * ten copies cost ten page entries, not ten images.
 */
export async function makeLayoutResult(input: LayoutResultInput): Promise<StudioResult> {
  const sheet = sheetSize(input.spec);
  const size = sheetPixels(input.spec, STUDIO_RENDER_DPI);
  const sheets: Blob[] = [];

  // In order, one at a time: see the note on memory above.
  for (let pageIndex = 0; pageIndex < input.pages.length; pageIndex += 1) {
    const page = input.pages[pageIndex];
    if (!page) continue;
    const canvas = scratchCanvas(size.width, size.height);
    const context = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context) throw new Error('This browser could not draw the page.');
    drawSheet(context, { ...input, page, pageIndex, dpi: STUDIO_RENDER_DPI, usePreview: false });
    sheets.push(await canvasToJpeg(canvas));
    input.onProgress?.(pageIndex + 1, input.pages.length);
  }
  return bindSheets(sheet, sheets, input.copies);
}

/** Sheet images as a result: a PDF with one page per sheet per copy, each the paper's exact size. */
export async function bindSheets(sheet: StudioSize, sheets: Blob[], copies: number): Promise<StudioResult> {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const count = Math.max(Math.trunc(copies), 1);
  const width = toPoints(sheet.width);
  const height = toPoints(sheet.height);
  // In order: the pages of the file follow the sheets.
  for (const jpeg of sheets) {
    const image = await pdf.embedJpg(await jpeg.arrayBuffer());
    for (let copy = 0; copy < count; copy += 1) {
      pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
    }
  }
  return { pdf: pdfBlob(await pdf.save()), sheets, sheet, pages: sheets.length, copies: count };
}

/** A PDF's bytes as a file-like object. Copied into a plain buffer: a `Blob` takes no shared memory. */
export function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}

/** Hand the result to the browser to save. The only way it ever reaches the disk. */
export function downloadResult(result: StudioResult, fileName: string): void {
  const url = URL.createObjectURL(result.pdf);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // After the click has been handled; revoking at once cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Open the browser's print dialog on the result.
 *
 * A hidden frame holding each sheet as an image, on a page declared to be the
 * paper's size with no margin — the point of sale's receipt approach.
 *
 * ⚠ THE BROWSER MAY IGNORE THE PAGE SIZE, and the person may leave "fit to
 * page" on. That is why Download is the main action and this is the second
 * (PRINT-STUDIO-PLAN decision 23). A document result has no sheet images and
 * prints its PDF in the frame directly.
 */
export function printResult(result: StudioResult): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  const urls: string[] = [];
  const cleanUp = () => {
    for (const url of urls) URL.revokeObjectURL(url);
    frame.remove();
  };

  if (result.sheets.length === 0) {
    const url = URL.createObjectURL(result.pdf);
    urls.push(url);
    frame.src = url;
    frame.addEventListener('load', () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    });
    document.body.append(frame);
    // A PDF viewer fires no `afterprint` the page can hear; the frame is dropped after a long while.
    setTimeout(cleanUp, 10 * 60_000);
    return;
  }

  const width = toMm(result.sheet.width);
  const height = toMm(result.sheet.height);
  document.body.append(frame);
  const doc = frame.contentDocument;
  if (!doc) {
    cleanUp();
    return;
  }
  doc.open();
  doc.write(
    `<!doctype html><html><head><style>@page{size:${width}mm ${height}mm;margin:0}html,body{margin:0;padding:0}img{display:block;width:${width}mm;height:${height}mm;break-after:page}img:last-child{break-after:auto}</style></head><body></body></html>`,
  );
  doc.close();

  const images: HTMLImageElement[] = [];
  for (const sheet of result.sheets) {
    const url = URL.createObjectURL(sheet);
    urls.push(url);
    for (let copy = 0; copy < result.copies; copy += 1) {
      const image = doc.createElement('img');
      image.src = url;
      image.alt = '';
      doc.body.append(image);
      images.push(image);
    }
  }
  void Promise.all(images.map((image) => image.decode().catch(() => undefined))).then(() => {
    frame.contentWindow?.addEventListener('afterprint', cleanUp);
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  });
}
