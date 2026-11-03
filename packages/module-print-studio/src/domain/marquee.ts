import { rectsOverlap, type StudioRect, type StudioSize } from './layout.js';

/**
 * A rectangle dragged over the sheet to select several cells at once (issue
 * #53) — the geometry of it, in SHEET units, so it means the same thing at any
 * view zoom and however far the view is scrolled.
 */

/** A point on the sheet, in units from its top left. */
export interface StudioPoint {
  x: number;
  y: number;
}

/**
 *   overlap — a cell the rectangle touches any part of. The default: small
 *             cells are hard to enclose whole.
 *   inside  — only a cell wholly inside the rectangle.
 */
export type StudioMarqueeRule = 'overlap' | 'inside';

/**
 * The rectangle between where a drag began and where it is now, whichever way
 * it was drawn: dragged up and to the left, its width and height are still
 * positive. A rectangle with a negative width would overlap nothing.
 */
export function rectBetween(from: StudioPoint, to: StudioPoint): StudioRect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/**
 * A point held to the sheet. A drag may begin in the grey around the paper or
 * wander off it; the rectangle is drawn, and tested, only where there is paper.
 */
export function clampToSheet(point: StudioPoint, sheet: StudioSize): StudioPoint {
  return {
    x: Math.min(Math.max(point.x, 0), sheet.width),
    y: Math.min(Math.max(point.y, 0), sheet.height),
  };
}

/** Whether `inner` lies wholly inside `outer`, edges included. */
export function rectContains(outer: StudioRect, inner: StudioRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * The indexes of the cells a rectangle selects, in the cells' own order. The
 * cells and the rectangle must be in the same coordinates (the sheet's — see
 * `cellOnSheet`).
 *
 * ⚠ TOUCHING IS NOT OVERLAPPING (`rectsOverlap`): a rectangle drawn along the
 * gap between two rows, its edge exactly on theirs, selects neither. A
 * rectangle with no height (a drag straight across) still selects the cells it
 * crosses the inside of.
 */
export function cellsInRect(
  rect: StudioRect,
  cells: readonly StudioRect[],
  rule: StudioMarqueeRule = 'overlap',
): number[] {
  const chosen: number[] = [];
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (!cell) continue;
    const takes = rule === 'inside' ? rectContains(rect, cell) : rectsOverlap(rect, cell);
    if (takes) chosen.push(index);
  }
  return chosen;
}
