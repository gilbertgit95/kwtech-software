'use client';

import { printableArea, type StudioLayoutSpec, type StudioSize, sheetSize } from '../../domain/layout.js';
import {
  groupIntoSheets,
  placeInSlot,
  type StudioPageFit,
  type StudioPagesPerSheet,
  sheetSlots,
} from '../../domain/page-layout.js';
import { toPoints, UNITS_PER_INCH } from '../../domain/units.js';
import { isPdfFile } from '../view/work.js';
import { pdfBlob, type StudioResult } from './result.js';

/**
 * A PDF the person chose, held IN MEMORY ONLY, for whole-page printing
 * (PRINT-STUDIO-PLAN §3). Never uploaded, never stored.
 */
export interface StudioDocument {
  name: string;
  bytes: Uint8Array;
  /** Each page's size, in units. */
  pages: StudioSize[];
}

/** The largest document the studio opens: 100 MB. Past it the tab holds the file several times over while it works. */
const DOCUMENT_BYTES_MAX = 100 * 1024 * 1024;

const POINTS_PER_INCH = 72;
const pointsToUnits = (points: number) => Math.round((points * UNITS_PER_INCH) / POINTS_PER_INCH);

/**
 * Read one PDF. Throws a sentence for the person.
 *
 * ⚠ A PASSWORD-PROTECTED PDF IS REFUSED, not opened with its protection
 * ignored: the person who locked it did not ask for it to be reprinted here.
 */
export async function loadDocument(file: File): Promise<StudioDocument> {
  if (!isPdfFile(file)) throw new Error(`“${file.name}” is not a PDF. Save the document as a PDF first.`);
  if (file.size > DOCUMENT_BYTES_MAX) throw new Error(`“${file.name}” is too large to open here.`);
  const { PDFDocument } = await import('pdf-lib');
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const source = await PDFDocument.load(bytes);
    const pages = source.getPages().map((page) => {
      const { width, height } = page.getSize();
      return { width: pointsToUnits(width), height: pointsToUnits(height) };
    });
    if (pages.length === 0) throw new Error('empty');
    return { name: file.name, bytes, pages };
  } catch {
    throw new Error(`“${file.name}” could not be opened. It may be password-protected or damaged.`);
  }
}

export interface DocumentResultInput {
  document: StudioDocument;
  /** The paper, orientation and margins to print on. Its cells are not used. */
  spec: Pick<StudioLayoutSpec, 'paper' | 'orientation' | 'margins'>;
  /** Zero-based page indexes, in the order to print them. */
  pages: readonly number[];
  perSheet: StudioPagesPerSheet;
  fit: StudioPageFit;
  /** Between pages that share a sheet, in units. */
  gap: number;
  copies: number;
}

/**
 * Lay a document's pages onto sheets of the chosen paper.
 *
 * ⚠ THE PAGES ARE COPIED, NOT REDRAWN. Each is embedded as it is — its text
 * stays text — and placed, scaled and clipped to its slot. Nothing is turned
 * into pixels, so a contract prints as sharp as its original.
 */
export async function makeDocumentResult(input: DocumentResultInput): Promise<StudioResult> {
  const { PDFDocument, clip, endPath, popGraphicsState, pushGraphicsState, rectangle } = await import('pdf-lib');
  const source = await PDFDocument.load(input.document.bytes);
  const out = await PDFDocument.create();

  const sheet = sheetSize(input.spec);
  const area = printableArea(input.spec);
  const slots = sheetSlots(area, input.perSheet, input.gap);
  const sheets = groupIntoSheets(input.pages, input.perSheet);
  const copies = Math.max(Math.trunc(input.copies), 1);
  const sheetHeight = toPoints(sheet.height);

  // Each wanted page embedded once, however many copies draw it.
  const wanted = [...new Set(input.pages)];
  const embedded = await out.embedPdf(source, wanted);
  const byIndex = new Map(wanted.map((pageIndex, at) => [pageIndex, embedded[at]]));

  for (let copy = 0; copy < copies; copy += 1) {
    for (const group of sheets) {
      const page = out.addPage([toPoints(sheet.width), sheetHeight]);
      for (let at = 0; at < group.length; at += 1) {
        const pageIndex = group[at];
        const slot = slots[at];
        const content = pageIndex === undefined ? undefined : byIndex.get(pageIndex);
        const size = pageIndex === undefined ? undefined : input.document.pages[pageIndex];
        if (!slot || !content || !size) continue;

        const placed = placeInSlot(size, slot, input.fit);
        // The slot and the page on the SHEET, from its top left.
        const slotX = area.x + slot.x;
        const slotY = area.y + slot.y;
        // ⚠ A PDF measures up from the BOTTOM left; everything here measures down from the top.
        const fromBottom = (top: number, height: number) => sheetHeight - toPoints(top + height);
        page.pushOperators(
          pushGraphicsState(),
          rectangle(toPoints(slotX), fromBottom(slotY, slot.height), toPoints(slot.width), toPoints(slot.height)),
          clip(),
          endPath(),
        );
        page.drawPage(content, {
          x: toPoints(slotX + placed.x),
          y: fromBottom(slotY + placed.y, placed.height),
          width: toPoints(placed.width),
          height: toPoints(placed.height),
        });
        page.pushOperators(popGraphicsState());
      }
    }
  }
  return { pdf: pdfBlob(await out.save()), sheets: [], sheet, pages: sheets.length, copies };
}
