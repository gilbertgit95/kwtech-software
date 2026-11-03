import type { StudioRefusal } from '../types.js';
import {
  checkCells,
  fitsInside,
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

/** Where a copy goes from the copied cell's TOP RIGHT corner, in units: right (`x`) and down (`y`), either signed. */
export interface StudioCopyOffset {
  x: number;
  y: number;
}

/** The copy's default place: touching the copied cell's right edge, on the same top. */
export const STUDIO_COPY_BESIDE: StudioCopyOffset = { x: 0, y: 0 };

/**
 * A copy of one cell — same size, same label — BESIDE it (the operator,
 * 2026-10-22): its top left at the copied cell's top right corner plus
 * `offset`, so by default it touches the cell's right edge on the same top,
 * and pressing Copy again on the copy builds a row. The person drags it from
 * there.
 *
 * Where that place is off the area or on another cell, the copy goes to the
 * first free place instead, as every copy once did, and `beside` says which
 * happened so the editor can say so.
 */
export function duplicateCell(
  area: StudioSize,
  cells: readonly StudioCell[],
  index: number,
  offset: StudioCopyOffset = STUDIO_COPY_BESIDE,
): StudioPlacement & { beside: boolean } {
  const cell = cells[index];
  if (!cell) return { cells: [...cells], placed: 0, left: 1, beside: false };
  const copy: StudioCell = { ...cell, x: cell.x + cell.width + offset.x, y: cell.y + offset.y };
  const fits =
    cells.length < STUDIO_CELLS_MAX && fitsInside(copy, area) && !cells.some((other) => rectsOverlap(copy, other));
  if (fits) return { cells: [...cells, copy], placed: 1, left: 0, beside: true };
  const elsewhere = addOfSize(area, cells, cell, 1, {
    allowRotate: false,
    ...(cell.label ? { label: cell.label } : {}),
  });
  return { ...elsewhere, beside: false };
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

// ── several cells at once (issue #53) ────────────────────────────────────────
//
// The editor can select several cells (a rectangle dragged over them, or
// Ctrl-clicks) and move, resize, turn, copy or remove them together. Each tool
// takes the selected INDEXES and, like the one-cell tools above, either gives
// back every cell or refuses: ⚠ ALL OR NOTHING. A group move that would put
// one cell on a cell outside the group leaves every cell where it was, never
// some moved and some not. A single index behaves exactly as the one-cell tool.

/** The smallest rectangle around the cells at `indexes`; null when none of them is there. */
export function boundsOf(cells: readonly StudioRect[], indexes: readonly number[]): StudioRect | null {
  const chosen = indexes.flatMap((index) => cells[index] ?? []);
  if (chosen.length === 0) return null;
  const left = Math.min(...chosen.map((cell) => cell.x));
  const top = Math.min(...chosen.map((cell) => cell.y));
  const right = Math.max(...chosen.map((cell) => cell.x + cell.width));
  const bottom = Math.max(...chosen.map((cell) => cell.y + cell.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Move a group so its bounding box's top left is at `position`, every cell by
 * the same distance: the group keeps its shape. ⚠ CLAMPED AS ONE: the box
 * stops at the area's edge, rather than each cell stopping on its own and the
 * group folding up against the edge.
 */
export function moveCells(
  area: StudioSize,
  cells: readonly StudioCell[],
  indexes: readonly number[],
  position: { x: number; y: number },
): { cells: StudioCell[] } | { refused: StudioRefusal } {
  const box = boundsOf(cells, indexes);
  if (!box) return { refused: 'invalid_spec' };
  const dx = clamp(Math.round(position.x), 0, Math.max(area.width - box.width, 0)) - box.x;
  const dy = clamp(Math.round(position.y), 0, Math.max(area.height - box.height, 0)) - box.y;
  const moving = new Set(indexes);
  return checked(
    area,
    cells.map((cell, at) => (moving.has(at) ? { ...cell, x: cell.x + dx, y: cell.y + dy } : cell)),
  );
}

/**
 * Where a dragged GROUP's top left lands once snapped: its bounding box's
 * edges pulled to the area's edges and to the edges of the cells NOT in it
 * (`snapPosition` for one cell). The result still goes through `moveCells`.
 */
export function snapGroupPosition(
  area: StudioSize,
  cells: readonly StudioCell[],
  indexes: readonly number[],
  position: { x: number; y: number },
  distance: number = STUDIO_SNAP_DISTANCE,
): { x: number; y: number } {
  const box = boundsOf(cells, indexes);
  if (!box) return position;
  const moving = new Set(indexes);
  const others = cells.filter((_cell, at) => !moving.has(at));
  const xEdges = [0, area.width, ...others.flatMap((other) => [other.x, other.x + other.width])];
  const yEdges = [0, area.height, ...others.flatMap((other) => [other.y, other.y + other.height])];
  return {
    x: snapAxis(position.x, box.width, xEdges, distance),
    y: snapAxis(position.y, box.height, yEdges, distance),
  };
}

/**
 * Give every cell of a group a new width, a new height, or both — each from
 * its OWN top left, so a row of cells made wider grows to the right one by
 * one, and refuses if they would then overlap. A side left out keeps each
 * cell's own. Their labels are dropped, as `resizeCell` drops one.
 */
export function resizeCells(
  area: StudioSize,
  cells: readonly StudioCell[],
  indexes: readonly number[],
  size: Partial<StudioSize>,
): { cells: StudioCell[] } | { refused: StudioRefusal } {
  if (!indexes.some((index) => cells[index])) return { refused: 'invalid_spec' };
  const resizing = new Set(indexes);
  return checked(
    area,
    cells.map((cell, at) => {
      if (!resizing.has(at)) return cell;
      const width = size.width ?? cell.width;
      const height = size.height ?? cell.height;
      return {
        x: cell.x,
        y: cell.y,
        width: clamp(Math.round(width), STUDIO_CELL_MIN, Math.max(area.width - cell.x, STUDIO_CELL_MIN)),
        height: clamp(Math.round(height), STUDIO_CELL_MIN, Math.max(area.height - cell.y, STUDIO_CELL_MIN)),
      };
    }),
  );
}

/** Turn every cell of a group a quarter, each about its own top left (`rotateCell`), or refuse them all. */
export function rotateCells(
  area: StudioSize,
  cells: readonly StudioCell[],
  indexes: readonly number[],
): { cells: StudioCell[] } | { refused: StudioRefusal } {
  if (!indexes.some((index) => cells[index])) return { refused: 'invalid_spec' };
  const turning = new Set(indexes);
  const turned: StudioCell[] = [];
  for (const [at, cell] of cells.entries()) {
    if (!turning.has(at)) {
      turned.push(cell);
      continue;
    }
    if (cell.height > area.width || cell.width > area.height) return { refused: 'cell_outside' };
    turned.push({
      ...cell,
      x: clamp(cell.x, 0, area.width - cell.height),
      y: clamp(cell.y, 0, area.height - cell.width),
      width: cell.height,
      height: cell.width,
    });
  }
  return checked(area, turned);
}

/** The cells without the ones at `indexes`. */
export function removeCells(cells: readonly StudioCell[], indexes: readonly number[]): StudioCell[] {
  const removing = new Set(indexes);
  return cells.filter((_cell, at) => !removing.has(at));
}

/**
 * A copy of a whole group, keeping its shape, BESIDE it: the copies' bounding
 * box starts at the group's top right corner plus `offset` (`duplicateCell`
 * for one cell). Where that place is off the area or on another cell, the
 * group goes to the first free place its bounding box fits, and `beside` says
 * which. `added` are the copies' indexes, for the editor to select.
 *
 * ⚠ THE COPY STAYS TOGETHER OR IS NOT MADE: a group that fits nowhere whole
 * places nothing, rather than scattering its cells.
 */
export function duplicateCells(
  area: StudioSize,
  cells: readonly StudioCell[],
  indexes: readonly number[],
  offset: StudioCopyOffset = STUDIO_COPY_BESIDE,
): StudioPlacement & { beside: boolean; added: number[] } {
  const box = boundsOf(cells, indexes);
  const group = [...new Set(indexes)].flatMap((index) => cells[index] ?? []);
  const none = { cells: [...cells], placed: 0, left: group.length, beside: false, added: [] };
  if (!box || cells.length + group.length > STUDIO_CELLS_MAX) return none;

  const shifted = (dx: number, dy: number) => group.map((cell) => ({ ...cell, x: cell.x + dx, y: cell.y + dy }));
  const added = group.map((_cell, at) => cells.length + at);
  const beside = shifted(box.width + offset.x, offset.y);
  const free = (copies: readonly StudioCell[]) =>
    copies.every((copy) => fitsInside(copy, area) && !cells.some((other) => rectsOverlap(copy, other)));
  if (free(beside)) return { cells: [...cells, ...beside], placed: group.length, left: 0, beside: true, added };

  const spot = firstFit(area, cells, box, 0);
  if (!spot) return none;
  const elsewhere = shifted(spot.x - box.x, spot.y - box.y);
  return { cells: [...cells, ...elsewhere], placed: group.length, left: 0, beside: false, added };
}

/** The cells as given, or the refusal `checkCells` has for them. */
function checked(area: StudioSize, cells: StudioCell[]): { cells: StudioCell[] } | { refused: StudioRefusal } {
  const refusal = checkCells(cells, area);
  return refusal ? { refused: refusal } : { cells };
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
