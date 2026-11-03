'use client';

import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { StudioRect, StudioSize } from '../domain/layout.js';
import { cellsInRect, clampToSheet, rectBetween, type StudioPoint } from '../domain/marquee.js';
import { coverChanged, edgeScrollStep, MARQUEE_HOLD_MS, marqueeStart, type StudioPressTarget } from './view/marquee.js';

/** How far the pointer must travel, in pixels, before a press is a rectangle and not a click. */
const MARQUEE_START_PX = 4;

/**
 * Marks put on the sheet's elements so a press can tell what it landed on.
 * The view that scrolls (`SheetFrame`) carries `data-studio-view`; each cell's
 * button carries `data-studio-cell`, with `data-filled` when a drag on it does
 * something of its own (moves a photo, or moves the cell in the editor); the
 * paper carries `data-studio-paper`.
 */
const VIEW_SELECTOR = '[data-studio-view]';
const CELL_SELECTOR = '[data-studio-cell]';
/** The paper itself, measured to turn screen pixels into sheet units: the Print screen's sheet, or the editor's SVG. */
const PAPER_SELECTOR = '[data-studio-paper]';

export interface MarqueeOptions {
  sheet: StudioSize;
  /** The cells of the page shown, in SHEET coordinates (`cellOnSheet`). */
  cells: readonly StudioRect[];
  /** Off while something else owns the presses on the sheet (the background picture being moved). */
  enabled: boolean;
  /** A rectangle has begun: the selection as it is now is what Esc goes back to. */
  onBegin: () => void;
  /** The cells the rectangle covers now, and whether it adds to the selection rather than replacing it. */
  onCover: (cells: readonly number[], adding: boolean) => void;
  /** The rectangle was given up (Esc, or the browser took the pointer): put the selection back. */
  onCancel: () => void;
  /** A press on the paper that never became a rectangle: a click on nothing. */
  onPaperClick: (adding: boolean) => void;
}

export interface Marquee {
  /** The rectangle being drawn, in sheet units, or null. */
  rect: StudioRect | null;
  /** Spread on the element around the sheet's view — presses anywhere inside it bubble up to these. */
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  };
  /** Ref to the element the handlers are on: it holds the pointer while a rectangle is drawn. */
  container: RefObject<HTMLDivElement | null>;
  /** Give up a rectangle in progress. Answers whether there was one — Esc does nothing else then. */
  cancel: () => boolean;
  /** Whether the last press drew a rectangle, so the click that follows it is not also a click on a cell. */
  drew: () => boolean;
}

/** A press that may become a rectangle, held in a ref so a pointer move never re-renders by itself. */
interface Press {
  pointerId: number;
  touch: boolean;
  from: StudioPressTarget;
  adding: boolean;
  /** Where it began, in client pixels and on the sheet. */
  startX: number;
  startY: number;
  start: StudioPoint;
  /** Where the pointer is now, in client pixels — read again as the view scrolls under it. */
  lastX: number;
  lastY: number;
  /** May draw. At once for a mouse or pen; for a finger, after it rested still (`MARQUEE_HOLD_MS`). */
  armed: boolean;
  /** Is drawing: it moved far enough, and holds the pointer. */
  drawing: boolean;
  /**
   * What `onCover` last reported; null until the first report, so a plain rectangle over nothing still replaces
   * the selection (with nothing) rather than leaving the old one.
   */
  covered: readonly number[] | null;
  hold: ReturnType<typeof setTimeout> | null;
}

/**
 * A rectangle dragged over the sheet to select the cells it covers (issue #53).
 *
 * ⚠ THE PRESS IS JUDGED WHERE IT LANDS, ON THE WAY UP. The handlers sit on an
 * element around the whole view and see every press inside it after the cell
 * under it did: a press on a photo was already taken by its drag
 * (`beginDrag`), and this lets it be. The pointer is captured only once the
 * press has moved, so a plain click still reaches the cell's own button.
 *
 * ⚠ A FINGER MUST REST FIRST. A one-finger drag scrolls a zoomed sheet on a
 * phone, and that must keep working; a finger held still for a moment draws
 * instead, and from then on its moves are kept from the browser (a touchmove
 * listener that is not passive — React's are).
 */
export function useMarquee(options: MarqueeOptions): Marquee {
  const container = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const drewLast = useRef(false);
  const frame = useRef(0);
  const [rect, setRect] = useState<StudioRect | null>(null);
  // The latest options, read by the scrolling loop and the timer, which outlive a render.
  const latest = useRef(options);
  latest.current = options;

  function toSheet(clientX: number, clientY: number): StudioPoint | null {
    const box = container.current?.querySelector(PAPER_SELECTOR)?.getBoundingClientRect();
    const { sheet } = latest.current;
    if (!box || !(box.width > 0)) return null;
    const scale = sheet.width / box.width;
    return { x: (clientX - box.left) * scale, y: (clientY - box.top) * scale };
  }

  /** The rectangle and its cells, from where the pointer is now. Re-renders only when either changed. */
  function update() {
    const current = press.current;
    if (!current?.drawing) return;
    const at = toSheet(current.lastX, current.lastY);
    if (!at) return;
    const { sheet, cells, onCover } = latest.current;
    const next = rectBetween(clampToSheet(current.start, sheet), clampToSheet(at, sheet));
    setRect((shown) => (shown && sameRect(shown, next) ? shown : next));
    const covered = cellsInRect(next, cells);
    if (!coverChanged(current.covered, covered)) return;
    current.covered = covered;
    onCover(covered, current.adding);
  }

  /** While drawing, every frame: scroll the view when the pointer is held at its edge, and follow it. */
  function scrollLoop() {
    const current = press.current;
    if (!current?.drawing) return;
    const view = container.current?.querySelector(VIEW_SELECTOR);
    if (view) {
      const step = edgeScrollStep({ x: current.lastX, y: current.lastY }, view.getBoundingClientRect());
      if (step.dx !== 0 || step.dy !== 0) {
        view.scrollBy(step.dx, step.dy);
        update();
      }
    }
    frame.current = requestAnimationFrame(scrollLoop);
  }

  function finish() {
    const current = press.current;
    if (current?.hold) clearTimeout(current.hold);
    if (current?.drawing && container.current?.hasPointerCapture(current.pointerId)) {
      container.current.releasePointerCapture(current.pointerId);
    }
    cancelAnimationFrame(frame.current);
    press.current = null;
    setRect(null);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    drewLast.current = false;
    if (!latest.current.enabled || event.button !== 0 || press.current) return;
    const target = event.target;
    // Only presses in the view itself: the zoom, the pager and the rulers are beside it, and keep theirs.
    if (!(target instanceof Element) || !target.closest(VIEW_SELECTOR)) return;
    const cell = target.closest(CELL_SELECTOR);
    const from = pressTarget(cell);
    const start = marqueeStart(from, event.pointerType, event.altKey);
    const at = toSheet(event.clientX, event.clientY);
    if (start === 'none' || !at) return;
    // A mouse on the paper: no text selected and no focus taken as it drags. A cell's button keeps its press.
    if (from === 'paper' && event.pointerType !== 'touch') event.preventDefault();
    const pointerId = event.pointerId;
    press.current = {
      pointerId,
      touch: start === 'hold',
      from,
      adding: event.ctrlKey || event.metaKey || event.shiftKey,
      startX: event.clientX,
      startY: event.clientY,
      start: at,
      lastX: event.clientX,
      lastY: event.clientY,
      armed: start === 'now',
      drawing: false,
      covered: null,
      hold:
        start === 'hold'
          ? setTimeout(() => {
              const current = press.current;
              if (current?.pointerId === pointerId) current.armed = true;
            }, MARQUEE_HOLD_MS)
          : null,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const current = press.current;
    if (!current || event.pointerId !== current.pointerId) return;
    current.lastX = event.clientX;
    current.lastY = event.clientY;
    if (!current.drawing) {
      if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < MARQUEE_START_PX) return;
      // A finger that moved before it rested is scrolling the view: it was never a rectangle.
      if (!current.armed) return finish();
      current.drawing = true;
      drewLast.current = true;
      container.current?.setPointerCapture(current.pointerId);
      latest.current.onBegin();
      frame.current = requestAnimationFrame(scrollLoop);
    }
    update();
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const current = press.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const clicked = !current.drawing && current.from === 'paper';
    const adding = current.adding;
    finish();
    if (clicked) latest.current.onPaperClick(adding);
  }

  /** The browser took the pointer (it began scrolling, or the window lost it): whatever was drawn is undone. */
  function onPointerCancel(event: ReactPointerEvent<HTMLElement>) {
    const current = press.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const drawing = current.drawing;
    finish();
    if (drawing) latest.current.onCancel();
  }

  /** A finger resting on the paper must not open the browser's menu for the picture under it. */
  function onContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (press.current?.touch) event.preventDefault();
  }

  function cancel(): boolean {
    if (!press.current?.drawing) return false;
    finish();
    latest.current.onCancel();
    return true;
  }

  /*
   * ⚠ NATIVE AND NOT PASSIVE: React's touch listeners are passive, and a
   * passive listener cannot stop the browser scrolling the view while a
   * rested finger draws.
   */
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const touchMove = (event: TouchEvent) => {
      if (press.current?.touch && press.current.armed && event.cancelable) event.preventDefault();
    };
    element.addEventListener('touchmove', touchMove, { passive: false });
    return () => element.removeEventListener('touchmove', touchMove);
  }, []);

  // Gone mid-drag (the screen closed): nothing left running.
  useEffect(
    () => () => {
      if (press.current?.hold) clearTimeout(press.current.hold);
      cancelAnimationFrame(frame.current);
    },
    [],
  );

  return {
    rect,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onContextMenu },
    container,
    cancel,
    drew: () => drewLast.current,
  };
}

/** What a press landed on: the paper, or a cell that a drag moves (`data-filled`) or does not. */
function pressTarget(cell: Element | null): StudioPressTarget {
  if (!cell) return 'paper';
  return cell.hasAttribute('data-filled') ? 'filled_cell' : 'empty_cell';
}

function sameRect(a: StudioRect, b: StudioRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
