import type { StudioRect } from './layout.js';
import { readingOrder } from './place.js';

/**
 * Which photo goes in which cell of which page (PRINT-STUDIO-PLAN §3,
 * decisions 6 and 19).
 *
 * A layout is one sheet's worth of cells. Filling it with more photos than it
 * has cells ADDS PAGES WITH THE SAME LAYOUT — the layout itself never grows.
 */

/**
 *   same      — the first photo in every cell of one page.
 *   sequence  — one photo per cell, in the order chosen; a new page for the rest.
 *   per_page  — each photo fills every cell of its own page. The usual case for
 *               several customers' ID photos.
 *   manual    — one empty page; the person places each photo by hand.
 */
export type StudioFillMode = 'same' | 'sequence' | 'per_page' | 'manual';

export const STUDIO_FILL_MODES = [
  'same',
  'sequence',
  'per_page',
  'manual',
] as const satisfies readonly StudioFillMode[];

/**
 * One page: for each cell of the layout, BY THE CELL'S INDEX IN THE SPEC, the
 * photo in it or null for an empty cell.
 */
export type StudioPageFill = (string | null)[];

/**
 * The most pages one result may have.
 *
 * ⚠ A BOUND ON BROWSER MEMORY, not a business rule. Each page is drawn as a
 * 300 dpi image before it goes into the result; an A4 is 8.7 million pixels.
 * Fifty is past a real job and short of the tab running out of memory.
 */
export const STUDIO_PAGES_MAX = 50;

export interface StudioFillPlan {
  pages: StudioPageFill[];
  /** Photos that found no place because the page limit was reached. */
  dropped: number;
}

/**
 * Lay photos out over pages of one layout.
 *
 * `sequence` fills in READING ORDER (top row first, left to right) rather than
 * the order the cells were drawn in, so the third photo chosen is the third
 * photo on the sheet however the layout was built.
 */
export function planFill(
  cells: readonly StudioRect[],
  photoIds: readonly string[],
  mode: StudioFillMode,
): StudioFillPlan {
  const empty = (): StudioPageFill => cells.map(() => null);
  if (cells.length === 0) return { pages: [], dropped: photoIds.length };

  switch (mode) {
    case 'manual':
      return { pages: [empty()], dropped: 0 };
    case 'same': {
      const photo = photoIds[0];
      if (photo === undefined) return { pages: [empty()], dropped: 0 };
      return { pages: [cells.map(() => photo)], dropped: 0 };
    }
    case 'per_page': {
      if (photoIds.length === 0) return { pages: [empty()], dropped: 0 };
      const used = photoIds.slice(0, STUDIO_PAGES_MAX);
      return { pages: used.map((photo) => cells.map(() => photo)), dropped: photoIds.length - used.length };
    }
    case 'sequence': {
      if (photoIds.length === 0) return { pages: [empty()], dropped: 0 };
      const order = readingOrder(cells);
      const room = cells.length * STUDIO_PAGES_MAX;
      const used = photoIds.slice(0, room);
      const pages: StudioPageFill[] = [];
      for (let start = 0; start < used.length; start += cells.length) {
        const page = empty();
        for (let offset = 0; offset < cells.length; offset += 1) {
          const cellIndex = order[offset];
          const photo = used[start + offset];
          if (cellIndex !== undefined && photo !== undefined) page[cellIndex] = photo;
        }
        pages.push(page);
      }
      return { pages, dropped: photoIds.length - used.length };
    }
  }
}

/** Another empty page, if there is room for one. Null at the page limit. */
export function addPage(pages: readonly StudioPageFill[], cellCount: number): StudioPageFill[] | null {
  if (pages.length >= STUDIO_PAGES_MAX) return null;
  return [...pages, Array.from({ length: cellCount }, () => null)];
}

/** One cell of one page set to a photo, or cleared with null. Out-of-range indexes change nothing. */
export function setCellPhoto(
  pages: readonly StudioPageFill[],
  pageIndex: number,
  cellIndex: number,
  photoId: string | null,
): StudioPageFill[] {
  return pages.map((page, at) => {
    if (at !== pageIndex || cellIndex < 0 || cellIndex >= page.length) return page;
    return page.map((current, cell) => (cell === cellIndex ? photoId : current));
  });
}

/**
 * Two cells' photos exchanged — what dragging one photo onto another does.
 * Across pages too: both are named by page and cell.
 */
export function swapCellPhotos(
  pages: readonly StudioPageFill[],
  from: { page: number; cell: number },
  to: { page: number; cell: number },
): StudioPageFill[] {
  const first = pages[from.page]?.[from.cell];
  const second = pages[to.page]?.[to.cell];
  if (first === undefined || second === undefined) return pages.map((page) => [...page]);
  return setCellPhoto(setCellPhoto(pages, from.page, from.cell, second), to.page, to.cell, first);
}

/** How many cells across all pages hold a photo — the count the log and the "nothing to print" check use. */
export function filledCellCount(pages: readonly StudioPageFill[]): number {
  let count = 0;
  for (const page of pages) count += page.filter((photo) => photo !== null).length;
  return count;
}

/** The photos actually used on any page, each once, in first-use order. */
export function usedPhotoIds(pages: readonly StudioPageFill[]): string[] {
  const seen = new Set<string>();
  for (const page of pages) {
    for (const photo of page) {
      if (photo !== null) seen.add(photo);
    }
  }
  return [...seen];
}

/** A batch put in from a cell onwards: the pages as they now are, where the first photo landed, and what did not fit. */
export interface StudioFillFromPlan extends StudioFillPlan {
  /** The page the first photo went on, to show it; null when none was placed. */
  firstPage: number | null;
  placed: number;
}

/**
 * Photos put into the empty cells FROM A CELL ONWARDS (the operator,
 * 2026-10-22: a batch goes where it is dropped), one per cell in reading order
 * — top row first, left to right — on through the pages after it, adding
 * pages when they run out.
 *
 * `from` is a cell by its index in the spec, on a page; the cells before it in
 * reading order, and the pages before, are left as they are. ⚠ IT NEVER TAKES
 * A FILLED CELL: one in the way is stepped over, and a drop on a filled cell
 * starts at the next empty one — a drop must never throw a placed photo away.
 * Past `STUDIO_PAGES_MAX` pages the rest are `dropped`.
 */
export function fillFromCell(
  cells: readonly StudioRect[],
  pages: readonly StudioPageFill[],
  photoIds: readonly string[],
  from: { page: number; cell: number },
): StudioFillFromPlan {
  const next = pages.map((page) => [...page]);
  if (cells.length === 0 || photoIds.length === 0) {
    return { pages: next, dropped: photoIds.length, firstPage: null, placed: 0 };
  }
  const order = readingOrder(cells);
  const slots = cells.length;
  const slot = Math.max(order.indexOf(from.cell), 0);

  let firstPage: number | null = null;
  let placed = 0;
  let position = Math.max(from.page, 0) * slots + slot;
  while (placed < photoIds.length) {
    const page = Math.floor(position / slots);
    const cellIndex = order[position % slots];
    if (page >= STUDIO_PAGES_MAX || cellIndex === undefined) break;
    while (next.length <= page) next.push(cells.map(() => null));
    const row = next[page];
    if (!row) break;
    position += 1;
    if (row[cellIndex]) continue;
    row[cellIndex] = photoIds[placed] ?? null;
    firstPage ??= page;
    placed += 1;
  }
  return { pages: next, dropped: photoIds.length - placed, firstPage, placed };
}
