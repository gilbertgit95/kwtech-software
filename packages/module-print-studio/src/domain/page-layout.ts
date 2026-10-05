import type { StudioRect, StudioSize } from './layout.js';

/**
 * Whole-page printing of documents (PRINT-STUDIO-PLAN §3, "Whole-page mode").
 *
 * A PDF never goes into a layout's cells (decision 5). It is printed page by
 * page onto a paper: one, two or four pages to a sheet, fitted or at its own
 * size. This file is that arithmetic; the pages themselves are copied into the
 * result as they are, so text stays sharp.
 */

/** How many document pages go on one sheet. */
export type StudioPagesPerSheet = 1 | 2 | 4;

export const STUDIO_PAGES_PER_SHEET = [1, 2, 4] as const satisfies readonly StudioPagesPerSheet[];

/**
 *   fit     — the whole page shows, scaled to fit, with bars if the shapes differ.
 *   fill    — the slot is covered, and the overflow is cut off.
 *   actual  — the page at its own size, centred; anything past the slot is cut off.
 */
export type StudioPageFit = 'fit' | 'fill' | 'actual';

export const STUDIO_PAGE_FITS = ['fit', 'fill', 'actual'] as const satisfies readonly StudioPageFit[];

/** The most document pages one result takes. A bound on browser memory, as `STUDIO_PAGES_MAX` is. */
export const STUDIO_DOCUMENT_PAGES_MAX = 500;

/**
 * A page range as people type it — "1-3, 5, 8-" — as zero-based page indexes
 * in the order asked for, or null when it is not a range.
 *
 * An empty range means every page. "8-" runs to the end and "-3" from the
 * start. A page past the end is dropped rather than refused: asking for 1-20
 * of a 12-page document means "all of it", not an error.
 */
export function parsePageRange(text: string, pageCount: number): number[] | null {
  const count = Math.max(Math.trunc(pageCount), 0);
  const trimmed = text.trim();
  if (trimmed === '') return Array.from({ length: count }, (_page, index) => index);

  const pages: number[] = [];
  for (const part of trimmed.split(',')) {
    const piece = part.trim();
    const match = /^(\d*)\s*(-?)\s*(\d*)$/u.exec(piece);
    if (!match || piece === '' || piece === '-') return null;
    const [, startText = '', dash = '', endText = ''] = match;
    // "3 5" matches the pattern with no dash; it is two numbers, not a range.
    if (dash === '' && endText !== '') return null;

    const start = startText === '' ? 1 : Number(startText);
    const end = rangeEnd(dash === '-', endText, start, count);
    if (start < 1 || end < start) return null;
    for (let page = start; page <= Math.min(end, count); page += 1) {
      pages.push(page - 1);
      if (pages.length > STUDIO_DOCUMENT_PAGES_MAX) return null;
    }
  }
  return pages;
}

/** Where one part of a range ends: itself for a single page, the last page for an open "8-". */
function rangeEnd(isRange: boolean, endText: string, start: number, count: number): number {
  if (!isRange) return start;
  if (endText === '') return count;
  return Number(endText);
}

/** The pages grouped into sheets: `perSheet` to each, the last possibly short. */
export function groupIntoSheets(pages: readonly number[], perSheet: StudioPagesPerSheet): number[][] {
  const sheets: number[][] = [];
  for (let start = 0; start < pages.length; start += perSheet) {
    sheets.push(pages.slice(start, start + perSheet));
  }
  return sheets;
}

/**
 * The slots on one sheet, in reading order, inside the printable area.
 *
 * Two to a sheet are side by side when the area is wide and one above the
 * other when it is tall, so each slot is as close to a page's shape as the
 * area allows. Four are always two by two.
 */
export function sheetSlots(area: StudioSize, perSheet: StudioPagesPerSheet, gap: number): StudioRect[] {
  const space = Math.max(gap, 0);
  switch (perSheet) {
    case 1:
      return [{ x: 0, y: 0, width: area.width, height: area.height }];
    case 2: {
      if (area.width >= area.height) {
        const width = Math.floor((area.width - space) / 2);
        return [
          { x: 0, y: 0, width, height: area.height },
          { x: width + space, y: 0, width, height: area.height },
        ];
      }
      const height = Math.floor((area.height - space) / 2);
      return [
        { x: 0, y: 0, width: area.width, height },
        { x: 0, y: height + space, width: area.width, height },
      ];
    }
    case 4: {
      const width = Math.floor((area.width - space) / 2);
      const height = Math.floor((area.height - space) / 2);
      return [
        { x: 0, y: 0, width, height },
        { x: width + space, y: 0, width, height },
        { x: 0, y: height + space, width, height },
        { x: width + space, y: height + space, width, height },
      ];
    }
  }
}

/**
 * Where a page of `content` size is drawn for a slot, relative to the slot's
 * top left. May be larger than the slot (`fill`, `actual`): the renderer clips
 * to the slot.
 */
export function placeInSlot(content: StudioSize, slot: StudioSize, fit: StudioPageFit): StudioRect {
  const scale = slotScale(content, slot, fit);
  const width = content.width * scale;
  const height = content.height * scale;
  return { x: (slot.width - width) / 2, y: (slot.height - height) / 2, width, height };
}

function slotScale(content: StudioSize, slot: StudioSize, fit: StudioPageFit): number {
  if (content.width <= 0 || content.height <= 0) return 1;
  const across = slot.width / content.width;
  const down = slot.height / content.height;
  switch (fit) {
    case 'fit':
      return Math.min(across, down);
    case 'fill':
      return Math.max(across, down);
    case 'actual':
      return 1;
  }
}
