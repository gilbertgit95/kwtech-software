import type { StudioRefusal } from '../types.js';
import { STUDIO_PAPER_MAX, STUDIO_PAPER_MIN } from './papers.js';
import { STUDIO_CELL_MIN } from './sizes.js';
import { isWholeNumber } from './units.js';

/**
 * A layout: a paper, the part of it a printer can reach, and the cells that
 * divide that part (PRINT-STUDIO-PLAN §3, in that order).
 *
 * ⚠ A LAYOUT STORES THE EXACT CELLS THAT WERE DRAWN (decision 14). Not "four
 * 2×2 and eight 1×1" to be packed again on every use: a packer that improves
 * would then silently move the cells of every saved layout, and a shop that
 * lined its cutter up against one would find out on paper.
 *
 * Every length is a whole number of hundredths of a millimetre (`units.ts`).
 */

export type StudioOrientation = 'portrait' | 'landscape';

/** The unprintable border of the sheet AS ORIENTED: `top` is the top of the sheet the person sees. */
export interface StudioMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * One place a photo goes.
 *
 * ⚠ `x` AND `y` ARE MEASURED FROM THE PRINTABLE AREA'S TOP LEFT, not the
 * sheet's. Cells divide the printable area, so widening a margin moves them
 * with it rather than leaving them hanging over the edge.
 */
export interface StudioCell {
  x: number;
  y: number;
  width: number;
  height: number;
  /** What the person called this size ("2 × 2"), shown on the cell. Not a key into anything. */
  label?: string;
}

/** The paper a layout was made on — a COPY of its size, so a registry change never moves a layout. */
export interface StudioLayoutPaper {
  /** A built-in paper's key, or null for a typed size. For showing a name only. */
  key: string | null;
  label: string;
  /** Portrait: `width <= height`. Landscape is `StudioLayoutSpec.orientation`. */
  width: number;
  height: number;
}

export interface StudioLayoutSpec {
  /**
   * The shape of THIS object. Bumped only by a change an older reader would
   * misread; `prepareLayoutSpec` refuses any other value rather than guessing.
   */
  version: 1;
  paper: StudioLayoutPaper;
  orientation: StudioOrientation;
  margins: StudioMargins;
  cells: StudioCell[];
  /** Whether a border is printed around the cells, to cut along. */
  guides: boolean;
  /**
   * How that border is drawn. Absent means the default (`DEFAULT_BORDER`): a
   * layout saved before borders could be chosen has none, and prints as it
   * always did.
   */
  border?: StudioBorder;
  /**
   * How the cells are measured. Absent means `fixed`: a layout saved before
   * there was a choice keeps every cell at its exact size on any paper.
   */
  sizing?: StudioSizing;
}

/**
 * How a layout's cells are measured (the operator, 2026-10-07).
 *
 *   fixed   — exact sizes. A 2 × 2 is 2 × 2 inches on any paper; a paper too
 *             small for the cells cannot be printed on.
 *   percent — shares of the printable area. A cell that is half the page wide
 *             is half of ANY page wide, so the layout follows the paper a
 *             print goes on.
 *
 * ⚠ A PERCENT LAYOUT STILL STORES ITS CELLS IN UNITS, as they are on the paper
 * it was made on. The percentages are those cells over that paper's printable
 * area, worked out when another paper is asked for (`layoutOnPage`). Storing
 * fractions instead would bring floats into every overlap check (`units.ts`),
 * and would need a second renderer for a sheet that is drawn only one way.
 */
export type StudioSizing = 'fixed' | 'percent';

export const STUDIO_SIZINGS = ['fixed', 'percent'] as const satisfies readonly StudioSizing[];

/** How a layout's cells are measured, its own choice or the default. */
export function sizingOf(spec: Pick<StudioLayoutSpec, 'sizing'>): StudioSizing {
  return spec.sizing ?? 'fixed';
}

/** The parts of a layout that say what page it is on. Changing any of them changes the printable area. */
export type StudioPagePatch = Partial<Pick<StudioLayoutSpec, 'paper' | 'orientation' | 'margins'>>;

/** Whether the border is one unbroken line or a row of dashes. */
export type StudioBorderStyle = 'solid' | 'dashed';

/** How dark the border is: grey disappears under the blade; black shows on a pale design. */
export type StudioBorderColor = 'grey' | 'black';

/**
 * The border printed around each cell (the operator, 2026-10-05).
 *
 * A pale photo on white paper has no visible edge, and nobody can tell where
 * to cut. So the line is a choice: solid or dashed, how thick, and how dark.
 */
export interface StudioBorder {
  style: StudioBorderStyle;
  /** The line's thickness, in hundredths of a millimetre. */
  width: number;
  color: StudioBorderColor;
}

export const STUDIO_BORDER_STYLES = ['solid', 'dashed'] as const satisfies readonly StudioBorderStyle[];
export const STUDIO_BORDER_COLORS = ['grey', 'black'] as const satisfies readonly StudioBorderColor[];

/** The thinnest and thickest a border may be: 0.05 mm (under one printed dot) to 3 mm. */
export const STUDIO_BORDER_WIDTH_MIN = 5;
export const STUDIO_BORDER_WIDTH_MAX = 300;

/**
 * What a layout with no border of its own prints: a hairline in grey, one
 * printed dot wide at 300 dpi — exactly the "cut guides" the studio drew
 * before the border could be chosen.
 */
export const DEFAULT_BORDER: StudioBorder = { style: 'solid', width: 8, color: 'grey' };

/** The border a layout prints with, its own or the default. */
export function borderOf(spec: Pick<StudioLayoutSpec, 'border'>): StudioBorder {
  return spec.border ?? DEFAULT_BORDER;
}

/** A rectangle. Used for the sheet, the printable area and anything placed in them. */
export interface StudioRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StudioSize {
  width: number;
  height: number;
}

export const STUDIO_ORIENTATIONS = ['portrait', 'landscape'] as const satisfies readonly StudioOrientation[];

/**
 * The most cells one layout may hold. A4 filled with 1×1s at no gap is 88, so
 * 400 is far past any real sheet — it exists because the spec is JSON a client
 * sends, and an unbounded list is an unbounded row and an O(n²) overlap check.
 */
export const STUDIO_CELLS_MAX = 400;

export const STUDIO_LAYOUT_NAME_MAX = 80;
const STUDIO_LABEL_MAX = 40;

/** The sheet as the person sees it: the paper's size, turned if landscape. */
export function sheetSize(spec: Pick<StudioLayoutSpec, 'paper' | 'orientation'>): StudioSize {
  if (spec.orientation === 'portrait') return { width: spec.paper.width, height: spec.paper.height };
  return { width: spec.paper.height, height: spec.paper.width };
}

/** The part of the sheet a cell may occupy, in SHEET coordinates. May have no area — see `checkPrintableArea`. */
export function printableArea(spec: Pick<StudioLayoutSpec, 'paper' | 'orientation' | 'margins'>): StudioRect {
  const sheet = sheetSize(spec);
  return {
    x: spec.margins.left,
    y: spec.margins.top,
    width: sheet.width - spec.margins.left - spec.margins.right,
    height: sheet.height - spec.margins.top - spec.margins.bottom,
  };
}

/** A cell's rectangle on the SHEET — where the renderer draws it. */
export function cellOnSheet(spec: Pick<StudioLayoutSpec, 'margins'>, cell: StudioRect): StudioRect {
  return { x: cell.x + spec.margins.left, y: cell.y + spec.margins.top, width: cell.width, height: cell.height };
}

/** Whether two rectangles share any area. Touching edges do not overlap. */
export function rectsOverlap(a: StudioRect, b: StudioRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Whether `inner` lies wholly inside a box of this size whose top left is the origin. */
export function fitsInside(inner: StudioRect, box: StudioSize): boolean {
  return inner.x >= 0 && inner.y >= 0 && inner.x + inner.width <= box.width && inner.y + inner.height <= box.height;
}

/**
 * The margins leave something to print on: room for at least one smallest cell.
 * Margins that swallow the sheet are refused rather than saved as a layout
 * nothing can be placed in.
 */
export function checkPrintableArea(
  spec: Pick<StudioLayoutSpec, 'paper' | 'orientation' | 'margins'>,
): StudioRefusal | null {
  const area = printableArea(spec);
  if (area.width < STUDIO_CELL_MIN || area.height < STUDIO_CELL_MIN) return 'no_printable_area';
  return null;
}

/**
 * Whether these cells are a valid division of an area of this size: each at
 * least the smallest size, inside the area, and none over another.
 *
 * The editor calls this after every tool and every drag, and the server calls
 * it (through `prepareLayoutSpec`) before every save — one rule, so a layout
 * the editor allowed is never one the server refuses.
 */
export function checkCells(cells: readonly StudioRect[], area: StudioSize): StudioRefusal | null {
  if (cells.length > STUDIO_CELLS_MAX) return 'too_many_cells';
  for (const cell of cells) {
    if (cell.width < STUDIO_CELL_MIN || cell.height < STUDIO_CELL_MIN) return 'cell_too_small';
    if (!fitsInside(cell, area)) return 'cell_outside';
  }
  // Numeric work over pairs: every cell against the ones after it.
  for (let i = 0; i < cells.length; i += 1) {
    for (let j = i + 1; j < cells.length; j += 1) {
      const a = cells[i];
      const b = cells[j];
      if (a && b && rectsOverlap(a, b)) return 'cell_overlap';
    }
  }
  return null;
}

/**
 * Cells drawn on an area of one size, as they are on an area of another: each
 * keeps its share of the width and of the height.
 *
 * ⚠ ROUNDED PER EDGE, never per width: a cell's right edge and its
 * neighbour's left edge are the same number before, so they are the same
 * number after. Rounding the widths instead leaves two cells that touched a
 * unit apart, or a unit over each other — and an overlap is a refused layout.
 */
export function scaleCells(cells: readonly StudioCell[], from: StudioSize, to: StudioSize): StudioCell[] {
  if (!(from.width > 0) || !(from.height > 0)) return [...cells];
  const across = (value: number): number => Math.round((value * to.width) / from.width);
  const down = (value: number): number => Math.round((value * to.height) / from.height);
  return cells.map((cell) => {
    const x = across(cell.x);
    const y = down(cell.y);
    return { ...cell, x, y, width: across(cell.x + cell.width) - x, height: down(cell.y + cell.height) - y };
  });
}

/**
 * A layout on another page: another paper, turned the other way, or with
 * other margins.
 *
 * A `fixed` layout keeps its cells exactly — a cutter is lined up against
 * them — so only the page changes, and whether the cells still fit is asked
 * separately (`checkLayoutOnPaper`). A `percent` layout's cells are scaled
 * from the old printable area to the new one.
 *
 * ⚠ THE MARGINS ARE NEVER SCALED. They are what a printer cannot reach, in
 * millimetres, whatever is printed.
 *
 * ⚠ A page with no room on it leaves the cells as they were, on either side
 * of the change: scaling into nothing would flatten every cell to zero, and
 * there is no way back from that. The caller's own check says what is wrong.
 */
export function layoutOnPage(spec: StudioLayoutSpec, page: StudioPagePatch): StudioLayoutSpec {
  const next = { ...spec, ...page };
  if (sizingOf(spec) === 'fixed') return next;
  if (checkPrintableArea(spec) || checkPrintableArea(next)) return next;
  return { ...next, cells: scaleCells(spec.cells, printableArea(spec), printableArea(next)) };
}

/**
 * Whether a layout can be printed on ANOTHER page: another paper, or the
 * paper turned the other way, with the same margins and its cells as
 * `layoutOnPage` puts them there.
 *
 * The Print screen lets one print go on a different paper than the layout was
 * made on (the operator, 2026-10-07: the shop ran out of A4 and had long
 * bond), and turned the other way (the same day). A page is refused, with the
 * reason, when:
 *
 *   no_printable_area — the margins leave nothing of it;
 *   cell_outside      — a `fixed` cell would hang over its edge;
 *   cell_too_small    — a `percent` cell would shrink under the smallest cell.
 *
 * Overlaps are not asked again: they were settled when the layout was saved,
 * and neither keeping the cells nor scaling them per edge can make one.
 */
export function checkLayoutOnPaper(
  spec: StudioLayoutSpec,
  paper: StudioLayoutPaper,
  orientation: StudioOrientation = spec.orientation,
): StudioRefusal | null {
  const onPaper = layoutOnPage(spec, { paper, orientation });
  const refusal = checkPrintableArea(onPaper);
  if (refusal) return refusal;
  const area = printableArea(onPaper);
  for (const cell of onPaper.cells) {
    if (cell.width < STUDIO_CELL_MIN || cell.height < STUDIO_CELL_MIN) return 'cell_too_small';
    if (!fitsInside(cell, area)) return 'cell_outside';
  }
  return null;
}

/**
 * A layout spec as it arrives — JSON from a client, or a row read back — as a
 * clean spec, or the reason it is not one.
 *
 * ⚠ THE ONLY WAY A SPEC REACHES THE DATABASE. There is no ValidationPipe and
 * the column is `Json`, so without this a client stores whatever it sends: a
 * megabyte of cells, a paper a kilometre wide, a `NaN` that every later
 * calculation inherits. It also REBUILDS the object from known fields, so an
 * unknown property is dropped rather than stored.
 */
export function prepareLayoutSpec(value: unknown): { spec: StudioLayoutSpec } | { refused: StudioRefusal } {
  if (!isRecord(value) || value.version !== 1) return { refused: 'invalid_spec' };

  const paper = readPaper(value.paper);
  if (!paper) return { refused: 'invalid_paper' };
  const orientation = value.orientation;
  if (!isOrientation(orientation)) return { refused: 'invalid_spec' };
  const margins = readMargins(value.margins);
  if (!margins) return { refused: 'invalid_margins' };
  if (typeof value.guides !== 'boolean') return { refused: 'invalid_spec' };
  if (!Array.isArray(value.cells)) return { refused: 'invalid_spec' };
  // Before reading them, so a huge list is refused without being walked.
  if (value.cells.length > STUDIO_CELLS_MAX) return { refused: 'too_many_cells' };

  const cells: StudioCell[] = [];
  for (const entry of value.cells) {
    const cell = readCell(entry);
    if (!cell) return { refused: 'invalid_spec' };
    cells.push(cell);
  }

  // Absent or null is "the default"; anything else must be a border, or the whole spec is refused.
  const border = value.border === undefined || value.border === null ? undefined : readBorder(value.border);
  if (border === null) return { refused: 'invalid_spec' };
  // Absent or null is `fixed`, the default, and is stored as absent so the two never differ in a row.
  const sizing = value.sizing ?? 'fixed';
  if (!isSizing(sizing)) return { refused: 'invalid_spec' };

  const spec: StudioLayoutSpec = {
    version: 1,
    paper,
    orientation,
    margins,
    cells,
    guides: value.guides,
    ...(border ? { border } : {}),
    ...(sizing === 'percent' ? { sizing } : {}),
  };
  const refusal = checkPrintableArea(spec) ?? checkCells(cells, printableArea(spec));
  if (refusal) return { refused: refusal };
  return { spec };
}

/** A layout's name: trimmed, one line, not empty, at most `STUDIO_LAYOUT_NAME_MAX`. */
export function prepareLayoutName(value: unknown): { name: string } | { refused: StudioRefusal } {
  if (typeof value !== 'string') return { refused: 'invalid_name' };
  const name = cleanText(value);
  if (name.length === 0 || [...name].length > STUDIO_LAYOUT_NAME_MAX) return { refused: 'invalid_name' };
  return { name };
}

/** A saved layout is changed FROM a version; a save from an older one is refused, never merged. */
export function checkLayoutVersion(expected: number, current: number): StudioRefusal | null {
  return expected === current ? null : 'conflict';
}

/** A new, empty layout on a paper, with the same margin on every side. */
export function emptyLayoutSpec(paper: StudioLayoutPaper, margin: number): StudioLayoutSpec {
  return {
    version: 1,
    paper,
    orientation: 'portrait',
    margins: { top: margin, right: margin, bottom: margin, left: margin },
    cells: [],
    guides: true,
  };
}

/** One line of text with no control or invisible formatting characters, trimmed. */
export function cleanText(value: string): string {
  return value
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOrientation(value: unknown): value is StudioOrientation {
  return (STUDIO_ORIENTATIONS as readonly unknown[]).includes(value);
}

function isSizing(value: unknown): value is StudioSizing {
  return (STUDIO_SIZINGS as readonly unknown[]).includes(value);
}

function readPaper(value: unknown): StudioLayoutPaper | null {
  if (!isRecord(value)) return null;
  const { key, label, width, height } = value;
  if (key !== null && typeof key !== 'string') return null;
  if (typeof label !== 'string') return null;
  if (!isWholeNumber(width) || !isWholeNumber(height)) return null;
  if (width < STUDIO_PAPER_MIN || height > STUDIO_PAPER_MAX) return null;
  // Portrait by rule: landscape is the orientation, never a wide paper.
  if (width > height) return null;
  const cleanLabel = cleanText(label).slice(0, STUDIO_LABEL_MAX);
  return { key: key === null ? null : key.slice(0, STUDIO_LABEL_MAX), label: cleanLabel, width, height };
}

function readBorder(value: unknown): StudioBorder | null {
  if (!isRecord(value)) return null;
  const { style, width, color } = value;
  if (!(STUDIO_BORDER_STYLES as readonly unknown[]).includes(style)) return null;
  if (!(STUDIO_BORDER_COLORS as readonly unknown[]).includes(color)) return null;
  if (!isWholeNumber(width) || width < STUDIO_BORDER_WIDTH_MIN || width > STUDIO_BORDER_WIDTH_MAX) return null;
  return { style: style as StudioBorderStyle, width, color: color as StudioBorderColor };
}

function readMargins(value: unknown): StudioMargins | null {
  if (!isRecord(value)) return null;
  const { top, right, bottom, left } = value;
  if (!isLength(top) || !isLength(right) || !isLength(bottom) || !isLength(left)) return null;
  return { top, right, bottom, left };
}

function readCell(value: unknown): StudioCell | null {
  if (!isRecord(value)) return null;
  const { x, y, width, height, label } = value;
  if (!isLength(x) || !isLength(y) || !isLength(width) || !isLength(height)) return null;
  if (label === undefined || label === null) return { x, y, width, height };
  if (typeof label !== 'string') return null;
  const cleanLabel = cleanText(label).slice(0, STUDIO_LABEL_MAX);
  return cleanLabel ? { x, y, width, height, label: cleanLabel } : { x, y, width, height };
}

/** A whole, non-negative length no longer than the largest paper. */
function isLength(value: unknown): value is number {
  return isWholeNumber(value) && value >= 0 && value <= STUDIO_PAPER_MAX;
}
