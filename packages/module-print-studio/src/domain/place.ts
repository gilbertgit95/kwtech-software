import type { StudioRefusal } from '../types.js';
import {
  checkCells,
  rectsOverlap,
  STUDIO_CELLS_MAX,
  type StudioCell,
  type StudioRect,
  type StudioSize,
} from './layout.js';
import { STUDIO_CELL_MIN } from './sizes.js';

/**
 * The layout editor's tools (PRINT-STUDIO-PLAN §3, step 3): fill with a size,
 * add some of a size, split into a grid, and move or resize by hand.
 *
 * Every tool is a pure function from the cells there are to the cells there
 * will be. None mutates its input, and each is DETERMINISTIC: the same area,
 * cells and size always give the same placement, so a layout made on one
 * computer is the layout made on another.
 *
 * ⚠ THESE RUN IN THE EDITOR ONLY. What is saved is the cells they produced
 * (decision 14); nothing here is ever run again on a saved layout.
 *
 * `area` is the PRINTABLE area's size. Cells are measured from its top left.
 */

export interface StudioPlaceOptions {
  /** The space kept between cells, for the cutter. Not kept against the area's edge. */
  gap?: number;
  /** Whether a cell may be turned 90° when more fit that way. Default true. */
  allowRotate?: boolean;
  /** Shown on each cell placed ("2 × 2"). */
  label?: string;
}

export interface StudioPlacement {
  /** The cells there were, then the ones placed. */
  cells: StudioCell[];
  placed: number;
  /** How many of the count asked for did not fit. Always 0 for a fill. */
  left: number;
}

/**
 * Put up to `count` cells of one size into the free space, top row first, left
 * to right.
 *
 * Tries the size as given and turned 90°, each topped up with the other, and
 * keeps whichever places more — a passport photo (35 × 45 mm) fits six on a 4R
 * upright and eight on its side. A tie keeps the size as given.
 */
export function addOfSize(
  area: StudioSize,
  cells: readonly StudioCell[],
  size: StudioSize,
  count: number,
  options: StudioPlaceOptions = {},
): StudioPlacement {
  const wanted = Math.max(Math.min(Math.trunc(count), STUDIO_CELLS_MAX - cells.length), 0);
  const asked = Math.max(Math.trunc(count), 0);
  const gap = Math.max(options.gap ?? 0, 0);
  const upright = { width: size.width, height: size.height };
  const turned = { width: size.height, height: size.width };
  const mayTurn = (options.allowRotate ?? true) && size.width !== size.height;

  const first = placeInOrder(area, cells, mayTurn ? [upright, turned] : [upright], wanted, gap, options.label);
  if (!mayTurn) return { ...first, left: asked - first.placed };

  const second = placeInOrder(area, cells, [turned, upright], wanted, gap, options.label);
  const best = second.placed > first.placed ? second : first;
  return { ...best, left: asked - best.placed };
}

/** As many cells of one size as fit in the free space. */
export function fillWithSize(
  area: StudioSize,
  cells: readonly StudioCell[],
  size: StudioSize,
  options: StudioPlaceOptions = {},
): StudioPlacement {
  const placement = addOfSize(area, cells, size, STUDIO_CELLS_MAX, options);
  // "As many as fit" has nothing left over by definition.
  return { ...placement, left: 0 };
}

/**
 * Replace every cell with a grid of equal cells filling the area.
 *
 * Sizes are floored to whole units, so a grid may stop a hundredth of a
 * millimetre short of the right or bottom edge rather than one unit past it.
 * Returns null when the cells would be smaller than the smallest allowed.
 */
export function splitIntoGrid(
  area: StudioSize,
  rows: number,
  columns: number,
  options: Pick<StudioPlaceOptions, 'gap'> = {},
): StudioCell[] | null {
  const rowCount = Math.trunc(rows);
  const columnCount = Math.trunc(columns);
  if (rowCount < 1 || columnCount < 1 || rowCount * columnCount > STUDIO_CELLS_MAX) return null;

  const gap = Math.max(options.gap ?? 0, 0);
  const width = Math.floor((area.width - gap * (columnCount - 1)) / columnCount);
  const height = Math.floor((area.height - gap * (rowCount - 1)) / rowCount);
  if (width < STUDIO_CELL_MIN || height < STUDIO_CELL_MIN) return null;

  const cells: StudioCell[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      cells.push({ x: column * (width + gap), y: row * (height + gap), width, height });
    }
  }
  return cells;
}

/**
 * Move one cell to a new top left, kept inside the area.
 *
 * ⚠ CLAMPED, THEN CHECKED. Dragging past an edge stops at the edge; dragging
 * onto another cell is REFUSED (the caller leaves the cell where it was)
 * rather than nudged somewhere the person did not put it.
 */
export function moveCell(
  area: StudioSize,
  cells: readonly StudioCell[],
  index: number,
  position: { x: number; y: number },
): { cells: StudioCell[] } | { refused: StudioRefusal } {
  const cell = cells[index];
  if (!cell) return { refused: 'invalid_spec' };
  const moved: StudioCell = {
    ...cell,
    x: clamp(Math.round(position.x), 0, Math.max(area.width - cell.width, 0)),
    y: clamp(Math.round(position.y), 0, Math.max(area.height - cell.height, 0)),
  };
  return replaceCell(area, cells, index, moved);
}

/**
 * Give one cell a new size, from its top left. Its label is dropped: a 2 × 2
 * that was stretched is no longer a 2 × 2, and a label that says so would be
 * trusted at the cutter.
 */
export function resizeCell(
  area: StudioSize,
  cells: readonly StudioCell[],
  index: number,
  size: StudioSize,
): { cells: StudioCell[] } | { refused: StudioRefusal } {
  const cell = cells[index];
  if (!cell) return { refused: 'invalid_spec' };
  const resized: StudioCell = {
    x: cell.x,
    y: cell.y,
    width: clamp(Math.round(size.width), STUDIO_CELL_MIN, Math.max(area.width - cell.x, STUDIO_CELL_MIN)),
    height: clamp(Math.round(size.height), STUDIO_CELL_MIN, Math.max(area.height - cell.y, STUDIO_CELL_MIN)),
  };
  return replaceCell(area, cells, index, resized);
}

/** A block of cells to add in one go: rows × columns of one size, with a gap between them. */
export interface StudioBlock {
  rows: number;
  columns: number;
  /** Between the cells of the block, and kept from the cells already there. */
  gap?: number;
  label?: string;
  /** Where the block's centre should go, when the person dropped it somewhere. */
  point?: { x: number; y: number };
}

/**
 * Add a block of cells of one size — "three across, two down, 2 mm apart" —
 * as ONE thing: placed together, so the rows and columns the person asked for
 * are the rows and columns they get.
 *
 *   1. At the point they dropped it, when it is free there.
 *   2. Else in the first free place the whole block fits.
 *   3. Else cell by cell, wherever each fits (`addOfSize`) — and `left` says
 *      how many found no room. A block that cannot stay together is still
 *      better placed loose than not at all.
 */
export function addBlock(
  area: StudioSize,
  cells: readonly StudioCell[],
  size: StudioSize,
  block: StudioBlock,
): StudioPlacement {
  const rows = clamp(Math.trunc(block.rows), 1, STUDIO_CELLS_MAX);
  const columns = clamp(Math.trunc(block.columns), 1, STUDIO_CELLS_MAX);
  const gap = Math.max(block.gap ?? 0, 0);
  const count = rows * columns;
  const options = { gap, allowRotate: false, ...(block.label ? { label: block.label } : {}) };
  if (cells.length + count > STUDIO_CELLS_MAX) return addOfSize(area, cells, size, count, options);

  const whole: StudioSize = {
    width: columns * size.width + (columns - 1) * gap,
    height: rows * size.height + (rows - 1) * gap,
  };
  const spot = blockSpot(area, cells, whole, gap, block.point);
  if (!spot) return addOfSize(area, cells, size, count, options);

  const added: StudioCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      added.push({
        x: spot.x + column * (size.width + gap),
        y: spot.y + row * (size.height + gap),
        width: size.width,
        height: size.height,
        ...(block.label ? { label: block.label } : {}),
      });
    }
  }
  return { cells: [...cells, ...added], placed: count, left: 0 };
}

/** Where a whole block goes: the dropped point when free, else the first place it fits, else nowhere. */
function blockSpot(
  area: StudioSize,
  cells: readonly StudioCell[],
  whole: StudioSize,
  gap: number,
  point: { x: number; y: number } | undefined,
): { x: number; y: number } | null {
  if (whole.width > area.width || whole.height > area.height) return null;
  if (point) {
    const wanted = {
      x: clamp(Math.round(point.x - whole.width / 2), 0, area.width - whole.width),
      y: clamp(Math.round(point.y - whole.height / 2), 0, area.height - whole.height),
      ...whole,
    };
    if (!cells.some((cell) => rectsOverlap(wanted, cell))) return wanted;
  }
  return firstFit(area, cells, whole, gap);
}

/**
 * One more cell of a size, with its centre at a point the person chose — what
 * dropping a single size onto the sheet does. A block of one (`addBlock`).
 */
export function addAt(
  area: StudioSize,
  cells: readonly StudioCell[],
  size: StudioSize,
  point: { x: number; y: number },
  label?: string,
): StudioPlacement {
  return addBlock(area, cells, size, { rows: 1, columns: 1, point, ...(label ? { label } : {}) });
}

/** A copy of one cell — same size, same label — in the first free place. */
export function duplicateCell(area: StudioSize, cells: readonly StudioCell[], index: number): StudioPlacement {
  const cell = cells[index];
  if (!cell) return { cells: [...cells], placed: 0, left: 1 };
  return addOfSize(area, cells, cell, 1, { allowRotate: false, ...(cell.label ? { label: cell.label } : {}) });
}

/**
 * Turn one cell a quarter: its width and height change places, from its top
 * left, pulled back inside the area when the turn would push it out. It keeps
 * its label — a passport photo on its side is still a passport photo.
 */
export function rotateCell(
  area: StudioSize,
  cells: readonly StudioCell[],
  index: number,
): { cells: StudioCell[] } | { refused: StudioRefusal } {
  const cell = cells[index];
  if (!cell) return { refused: 'invalid_spec' };
  if (cell.height > area.width || cell.width > area.height) return { refused: 'cell_outside' };
  const turned: StudioCell = {
    ...cell,
    x: clamp(cell.x, 0, area.width - cell.height),
    y: clamp(cell.y, 0, area.height - cell.width),
    width: cell.height,
    height: cell.width,
  };
  return replaceCell(area, cells, index, turned);
}

/** The cells without one of them. */
export function removeCell(cells: readonly StudioCell[], index: number): StudioCell[] {
  return cells.filter((_cell, at) => at !== index);
}

/**
 * How close, in units, a dragged edge must come to another edge to snap to it:
 * 1.5 mm. Enough to catch a deliberate alignment, too little to fight a
 * deliberate gap.
 */
export const STUDIO_SNAP_DISTANCE = 150;

/**
 * Where a dragged cell's top left lands once snapped: its edges are pulled to
 * the area's edges and to the other cells' edges when within `distance`.
 * Each axis snaps on its own. The result still goes through `moveCell`.
 */
export function snapPosition(
  area: StudioSize,
  cells: readonly StudioCell[],
  index: number,
  position: { x: number; y: number },
  distance: number = STUDIO_SNAP_DISTANCE,
): { x: number; y: number } {
  const cell = cells[index];
  if (!cell) return position;
  const others = cells.filter((_other, at) => at !== index);

  const xEdges = [0, area.width, ...others.flatMap((other) => [other.x, other.x + other.width])];
  const yEdges = [0, area.height, ...others.flatMap((other) => [other.y, other.y + other.height])];
  return {
    x: snapAxis(position.x, cell.width, xEdges, distance),
    y: snapAxis(position.y, cell.height, yEdges, distance),
  };
}

/** The indexes of the cells in reading order: top row first, left to right. */
export function readingOrder(cells: readonly StudioRect[]): number[] {
  return cells
    .map((cell, index) => ({ cell, index }))
    .sort((a, b) => a.cell.y - b.cell.y || a.cell.x - b.cell.x || a.index - b.index)
    .map((entry) => entry.index);
}

// ── placement ────────────────────────────────────────────────────────────────

/**
 * Place up to `count` cells, trying each shape in turn until it stops fitting.
 *
 * FIRST FIT, TOP LEFT. A cell can only usefully start at the area's edge or
 * just past another cell (plus the gap), so those are the only positions
 * tried — the rows and columns the existing cells define. Scanned top row
 * first, then left to right, which is the order a person reads the sheet and
 * the order a cutter works down it.
 */
function placeInOrder(
  area: StudioSize,
  existing: readonly StudioCell[],
  shapes: readonly StudioSize[],
  count: number,
  gap: number,
  label: string | undefined,
): { cells: StudioCell[]; placed: number } {
  const cells: StudioCell[] = [...existing];
  let placed = 0;
  for (const shape of shapes) {
    while (placed < count) {
      const spot = firstFit(area, cells, shape, gap);
      if (!spot) break;
      cells.push(label ? { ...spot, label } : spot);
      placed += 1;
    }
  }
  return { cells, placed };
}

function firstFit(area: StudioSize, cells: readonly StudioCell[], shape: StudioSize, gap: number): StudioRect | null {
  if (shape.width > area.width || shape.height > area.height) return null;

  const xs = uniqueSorted([0, ...cells.map((cell) => cell.x + cell.width + gap)]);
  const ys = uniqueSorted([0, ...cells.map((cell) => cell.y + cell.height + gap)]);
  for (const y of ys) {
    if (y + shape.height > area.height) break;
    for (const x of xs) {
      if (x + shape.width > area.width) break;
      const candidate = { x, y, width: shape.width, height: shape.height };
      if (!cells.some((cell) => tooClose(candidate, cell, gap))) return candidate;
    }
  }
  return null;
}

/** Whether a new cell would overlap an existing one, or sit nearer to it than the gap. */
function tooClose(candidate: StudioRect, cell: StudioRect, gap: number): boolean {
  const kept = { x: cell.x - gap, y: cell.y - gap, width: cell.width + gap * 2, height: cell.height + gap * 2 };
  return rectsOverlap(candidate, kept);
}

function replaceCell(
  area: StudioSize,
  cells: readonly StudioCell[],
  index: number,
  next: StudioCell,
): { cells: StudioCell[] } | { refused: StudioRefusal } {
  const updated = cells.map((cell, at) => (at === index ? next : cell));
  const refusal = checkCells(updated, area);
  if (refusal) return { refused: refusal };
  return { cells: updated };
}

/** One axis of a snap: the start that brings the near or far edge onto the closest edge in reach. */
function snapAxis(start: number, length: number, edges: readonly number[], distance: number): number {
  let best = start;
  let reach = distance + 1;
  for (const edge of edges) {
    // The cell's near edge onto this edge, then its far edge onto it.
    for (const candidate of [edge, edge - length]) {
      const away = Math.abs(candidate - start);
      if (away < reach) {
        reach = away;
        best = candidate;
      }
    }
  }
  return best;
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
