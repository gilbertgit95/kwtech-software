import type { StudioCellRef } from './work.js';

/**
 * The rules of the selection rectangle on the Print screen (issue #53), kept
 * out of the pointer handling so they can be tested: where a rectangle may
 * start, what it does to the selection, and how fast the view scrolls when the
 * pointer is held at its edge.
 */

/** How long, in milliseconds, a finger must rest on the paper before its drag draws a rectangle rather than scrolling. */
export const MARQUEE_HOLD_MS = 400;

/** How far, in pixels, from the view's edge the pointer starts it scrolling during a drag. */
export const MARQUEE_EDGE_PX = 32;

/** The most the view scrolls in one frame, in pixels, with the pointer at (or past) its edge. */
export const MARQUEE_SCROLL_MAX_PX = 18;

/** What a press landed on. */
export type StudioPressTarget = 'paper' | 'empty_cell' | 'filled_cell';

/**
 *   none — the press is not the rectangle's: it moves a photo, or it is not on the sheet.
 *   now  — the rectangle begins as soon as the pointer moves.
 *   hold — a touch: only after resting still for `MARQUEE_HOLD_MS`. A finger that moves sooner scrolls the view, as
 *          before — a one-finger drag is how a zoomed sheet is scrolled on a phone, and that must keep working.
 */
export type StudioMarqueeStart = 'none' | 'now' | 'hold';

/**
 * Whether a press may start a rectangle.
 *
 * ⚠ A DRAG ON A PHOTO MOVES THE PHOTO (`beginDrag`), and that wins: the
 * rectangle starts only where a drag did nothing before — the paper, the
 * margin, the grey around the sheet, or an empty cell (most layouts leave
 * little paper between cells). Alt held starts one on a photo too.
 */
export function marqueeStart(target: StudioPressTarget, pointerType: string, altKey: boolean): StudioMarqueeStart {
  if (target === 'filled_cell' && !altKey) return 'none';
  return pointerType === 'touch' ? 'hold' : 'now';
}

/**
 * The selection while a rectangle is drawn over `cells` (indexes on `page`).
 *
 * Plain, it replaces the selection — including cells chosen on other pages: a
 * rectangle selects what it covers, nothing else. Adding (Ctrl, ⌘ or Shift),
 * the covered cells join `base`, the selection as it was when the drag began,
 * so a cell the rectangle passes over and leaves again drops back out.
 */
export function marqueeSelection(
  base: readonly StudioCellRef[],
  page: number,
  cells: readonly number[],
  adding: boolean,
): StudioCellRef[] {
  const covered = cells.map((cell) => ({ page, cell }));
  if (!adding) return covered;
  const added = covered.filter((ref) => !base.some((one) => one.page === ref.page && one.cell === ref.cell));
  return [...base, ...added];
}

/**
 * The same for the layout editor, whose selection is a layout's cell indexes
 * (one sheet, no pages): the covered cells replace `base`, or join it.
 */
export function marqueeIndexes(base: readonly number[], cells: readonly number[], adding: boolean): number[] {
  if (!adding) return [...cells];
  return [...base, ...cells.filter((cell) => !base.includes(cell))];
}

/**
 * A Ctrl-click in the editor: the cell joins the selection, last (it is the one
 * the panel shows), or leaves it if it was in.
 */
export function toggleIndex(selection: readonly number[], index: number): number[] {
  return selection.includes(index) ? selection.filter((one) => one !== index) : [...selection, index];
}

/**
 * Whether the cells a rectangle covers must be reported: always the first
 * time (`previous` null), even when it covers nothing — a plain rectangle over
 * bare paper replaces the selection with nothing — and after that only when
 * they changed, so a drag that covers nothing new re-renders nothing.
 */
export function coverChanged(previous: readonly number[] | null, next: readonly number[]): boolean {
  return previous === null || !sameIndexes(previous, next);
}

/** Whether two lists of cell indexes are the same — so a drag that covers nothing new re-renders nothing. */
export function sameIndexes(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * How far to scroll the view this frame, with the pointer at `point` (client
 * pixels) and the view at `box`. Faster the nearer the edge, and full speed
 * once past it. Zero, both ways, in the middle.
 */
export function edgeScrollStep(
  point: { x: number; y: number },
  box: { left: number; top: number; right: number; bottom: number },
): { dx: number; dy: number } {
  return { dx: axisStep(point.x, box.left, box.right), dy: axisStep(point.y, box.top, box.bottom) };
}

function axisStep(at: number, start: number, end: number): number {
  const before = start + MARQUEE_EDGE_PX - at;
  if (before > 0) return -Math.ceil(MARQUEE_SCROLL_MAX_PX * Math.min(before / MARQUEE_EDGE_PX, 1));
  const after = at - (end - MARQUEE_EDGE_PX);
  if (after > 0) return Math.ceil(MARQUEE_SCROLL_MAX_PX * Math.min(after / MARQUEE_EDGE_PX, 1));
  return 0;
}
