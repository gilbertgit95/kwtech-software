import type { StudioRefusal } from '../types.js';
import type { StudioCell, StudioRect, StudioSize } from './layout.js';
import { boundsOf, duplicateCells, moveCells, STUDIO_COPY_BESIDE, type StudioCopyOffset } from './place.js';
import { STUDIO_TEXTS_MAX, type StudioText } from './texts.js';

/**
 * A selection of cells AND texts in the layout editor, acted on together
 * (issue #57): moved, removed and copied as one group that keeps its shape.
 *
 * Texts are measured by the caller (`measure`), because only the browser
 * knows how wide a line is in a font. Everything here is in units from the
 * printable area's top left, as cells and texts both are.
 *
 * ⚠ THE GROUP MOVES AS ONE. It is clamped by its bounding box, cells and
 * texts together, so it stops at the edge as a whole: one text pushed back
 * inside while the rest went on would change the design. A move that would
 * put a cell over a cell that stays is refused whole, texts included.
 */

/** How to size a text, from its words, font and size. */
export type StudioMeasure = (text: StudioText) => StudioSize;

/** What a group is made of: cell indexes, and text ids. */
export interface StudioGroup {
  cells: readonly number[];
  texts: readonly string[];
}

/** The cells and texts of a layout, which a group change returns both of. */
export interface StudioGroupLayout {
  cells: StudioCell[];
  texts: StudioText[];
}

/** Whether a group has anything in it. */
export function isEmptyGroup(group: StudioGroup): boolean {
  return group.cells.length === 0 && group.texts.length === 0;
}

/** The box around a group: its cells and its texts' boxes. Null for an empty group. */
export function groupBounds(
  layout: Readonly<StudioGroupLayout>,
  group: StudioGroup,
  measure: StudioMeasure,
): StudioRect | null {
  const rects: StudioRect[] = [];
  const cellBox = boundsOf(layout.cells, group.cells);
  if (cellBox) rects.push(cellBox);
  for (const text of layout.texts) {
    if (group.texts.includes(text.id)) rects.push({ x: text.x, y: text.y, ...measure(text) });
  }
  return unionOf(rects);
}

/**
 * The group moved by `delta`, as one, clamped by its bounding box to the
 * printable area (rounded to whole units, as `moveCells` does). Refused when
 * a moved cell would land on a cell that stays.
 */
export function moveGroup(
  area: StudioSize,
  layout: Readonly<StudioGroupLayout>,
  group: StudioGroup,
  delta: { x: number; y: number },
  measure: StudioMeasure,
): StudioGroupLayout | { refused: StudioRefusal } {
  const box = groupBounds(layout, group, measure);
  if (!box) return { refused: 'invalid_spec' };
  const dx = clamp(Math.round(box.x + delta.x), 0, Math.max(area.width - box.width, 0)) - box.x;
  const dy = clamp(Math.round(box.y + delta.y), 0, Math.max(area.height - box.height, 0)) - box.y;
  let cells = [...layout.cells];
  const cellBox = boundsOf(layout.cells, group.cells);
  if (cellBox) {
    const moved = moveCells(area, layout.cells, group.cells, { x: cellBox.x + dx, y: cellBox.y + dy });
    if ('refused' in moved) return moved;
    cells = moved.cells;
  }
  const texts = layout.texts.map((text) =>
    group.texts.includes(text.id) ? { ...text, x: text.x + dx, y: text.y + dy } : text,
  );
  return { cells, texts };
}

/** The layout without the group's cells and texts. */
export function removeGroup(layout: Readonly<StudioGroupLayout>, group: StudioGroup): StudioGroupLayout {
  return {
    cells: layout.cells.filter((_cell, index) => !group.cells.includes(index)),
    texts: layout.texts.filter((text) => !group.texts.includes(text.id)),
  };
}

/** A group copied: the layout with the copies, the copies' indexes and ids, and where they went. */
export interface StudioGroupCopy extends StudioGroupLayout {
  /** The copies, which become the selection. Empty when there was no room. */
  added: StudioGroup;
  /** Beside the original (or under it, for texts alone), as asked; false when it went to the first free place. */
  beside: boolean;
}

/**
 * A copy of the group that keeps its shape.
 *
 *   - With cells, the cells decide where the copy goes (`duplicateCells`:
 *     beside, or the first free place) and the texts follow by the same
 *     distance, so a label stays under its photo.
 *   - Texts alone go under the group, `textOffset` from its bottom left, as
 *     one text's copy does (`textCopyPosition`), clamped as one.
 *
 * ⚠ NOTHING IS COPIED WHEN IT CANNOT ALL BE: no room for the cells, or more
 * texts than a layout holds. A half copy is a design nobody drew.
 */
export function copyGroup(
  area: StudioSize,
  layout: Readonly<StudioGroupLayout>,
  group: StudioGroup,
  options: {
    measure: StudioMeasure;
    newId: () => string;
    cellOffset?: StudioCopyOffset;
    textOffset?: StudioCopyOffset;
  },
): StudioGroupCopy {
  const none: StudioGroupCopy = {
    cells: [...layout.cells],
    texts: [...layout.texts],
    added: { cells: [], texts: [] },
    beside: false,
  };
  const copied = layout.texts.filter((text) => group.texts.includes(text.id));
  if (layout.texts.length + copied.length > STUDIO_TEXTS_MAX) return none;

  let cells = [...layout.cells];
  let addedCells: number[] = [];
  let beside = true;
  let delta: { x: number; y: number };
  const cellBox = boundsOf(layout.cells, group.cells);
  if (cellBox) {
    const copy = duplicateCells(area, layout.cells, group.cells, options.cellOffset ?? STUDIO_COPY_BESIDE);
    const copyBox = boundsOf(copy.cells, copy.added);
    if (copy.placed === 0 || !copyBox) return none;
    cells = copy.cells;
    addedCells = copy.added;
    beside = copy.beside;
    delta = { x: copyBox.x - cellBox.x, y: copyBox.y - cellBox.y };
  } else {
    const box = groupBounds(layout, group, options.measure);
    if (!box) return none;
    const offset = options.textOffset ?? { x: 0, y: 0 };
    const wanted = { x: box.x + offset.x, y: box.y + box.height + offset.y };
    const x = clamp(Math.round(wanted.x), 0, Math.max(area.width - box.width, 0));
    const y = clamp(Math.round(wanted.y), 0, Math.max(area.height - box.height, 0));
    beside = x === wanted.x && y === wanted.y;
    delta = { x: x - box.x, y: y - box.y };
  }

  /*
   * ⚠ EVERY TEXT GOES THE SAME DISTANCE, OR NONE IS COPIED. The cells' copy was placed for the cells alone, and a
   * caption wider than its cell can then hang past the edge. Pulling that one text back in by itself would move it
   * against its cell, onto it even: a design nobody drew (CodeRabbit on #58).
   */
  const fresh = copied.map((text) => ({ ...text, id: options.newId(), x: text.x + delta.x, y: text.y + delta.y }));
  const outside = fresh.some((text) => {
    const box = options.measure(text);
    return text.x < 0 || text.y < 0 || text.x + box.width > area.width || text.y + box.height > area.height;
  });
  if (outside) return none;
  return {
    cells,
    texts: [...layout.texts, ...fresh],
    added: { cells: addedCells, texts: fresh.map((text) => text.id) },
    beside,
  };
}

function unionOf(rects: readonly StudioRect[]): StudioRect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
