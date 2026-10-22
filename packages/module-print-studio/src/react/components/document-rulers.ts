'use client';

import { STUDIO_EDITOR_DPI } from '../../domain/custom-document.js';
import { UNITS_PER_INCH } from '../../domain/units.js';
import { editorRulerMarks, type StudioRulerUnit } from '../view/ruler-ticks.js';

/**
 * The document editor's rulers, in a unit of the person's choice (the
 * operator, 2026-10-11: "is it possible to change the ruler unit").
 *
 * ⚠ THE LIBRARY'S RULER COUNTS IN CENTIMETRES AND NOTHING ELSE: its marks are
 * a millimetre apart and numbered every ten, with no option for another unit
 * (`IRulerOption` is `disabled` and `height`). So its two canvases are painted
 * OVER, whole, each time it has drawn them. Everything else stays the
 * library's: where the rulers sit, and the margin markers and their dragging,
 * which only read where the pointer is and never what was drawn.
 *
 * The alternative — the library's ruler off and one of our own — would mean
 * writing the margin dragging again, clamping and all, to change some numbers.
 */

/** What the rulers are painted from, read each time the library has drawn them. */
export interface StudioEditorRulerState {
  unit: StudioRulerUnit;
  /** The editor's zoom: 1 is 100%. */
  scale: number;
  /** The margins as the editor holds them, unscaled, in its order: top, right, bottom, left. */
  margins: readonly number[];
}

/** The rulers being watched: paint them again now (the unit changed), or stop. */
export interface StudioEditorRulers {
  repaint: () => void;
  stop: () => void;
}

/*
 * The library's own ruler colours. Not theme tokens, deliberately: this
 * paints over what the library painted, on white as the page beside it is,
 * and must match what its margin markers were drawn for.
 */
const RULER_PAPER = '#ffffff';
const RULER_MARGIN = '#f2f2f2';
const RULER_MARK = '#999999';
const RULER_NUMBER = '#666666';
const RULER_EDGE = '#e0e0e0';
const RULER_HANDLE = '#595959';
const RULER_FONT = '8px sans-serif';

/** Where a number's middle sits across the ruler, and the margin markers' size, in pixels: the library's. */
const NUMBER_ACROSS_PX = 9;
const HANDLE_HALF_PX = 5;
const HANDLE_DEEP_PX = 7;

/**
 * Keep the editor's rulers in `read()`'s unit for as long as the editor lives.
 * `read` answers null while the rulers are off, and then nothing is painted.
 *
 * ⚠ AFTER EVERY DRAW OF THE LIBRARY'S, WHICH SAYS NOTHING WHEN IT DRAWS: it
 * sets each ruler canvas's `width` on every draw (a keystroke, a zoom, a
 * dragged margin), and setting an attribute is a mutation even when the value
 * is the same. The observer runs before the browser paints, so the
 * centimetres are never seen. Painting sets no attribute, so it cannot call
 * itself.
 */
export function watchEditorRulers(host: HTMLElement, read: () => StudioEditorRulerState | null): StudioEditorRulers {
  function repaint() {
    const state = read();
    if (!state) return;
    const across = host.querySelector<HTMLCanvasElement>('canvas.ce-ruler-x');
    const down = host.querySelector<HTMLCanvasElement>('canvas.ce-ruler-y');
    if (across) paintRuler(across, 'x', state);
    if (down) paintRuler(down, 'y', state);
  }
  // `childList` too: the library makes its rulers the first time they are shown, which may be after this.
  const observer = new MutationObserver(repaint);
  observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['width', 'height'] });
  repaint();
  return { repaint, stop: () => observer.disconnect() };
}

/**
 * Paint one ruler: the paper, the margins shaded, the marks and numbers in
 * the unit, the edge line and the two margin markers.
 *
 * ⚠ THE CONTEXT IS LEFT AS THE LIBRARY SET IT, scaled for the screen's pixel
 * ratio, so everything here is in CSS pixels as its own drawing is. The size
 * is read from the canvas's style, which the library sets in those pixels.
 */
function paintRuler(canvas: HTMLCanvasElement, axis: 'x' | 'y', state: StudioEditorRulerState): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const width = Number.parseFloat(canvas.style.width);
  const height = Number.parseFloat(canvas.style.height);
  if (!(width > 0) || !(height > 0)) return;
  const length = axis === 'x' ? width : height;
  const thick = axis === 'x' ? height : width;
  const [top = 0, right = 0, bottom = 0, left = 0] = state.margins;
  const before = (axis === 'x' ? left : top) * state.scale;
  const after = (axis === 'x' ? right : bottom) * state.scale;

  context.fillStyle = RULER_PAPER;
  fillBand(context, axis, 0, length, thick);
  context.fillStyle = RULER_MARGIN;
  fillBand(context, axis, 0, before, thick);
  fillBand(context, axis, length - after, length, thick);

  context.strokeStyle = RULER_MARK;
  context.fillStyle = RULER_NUMBER;
  context.font = RULER_FONT;
  context.textAlign = 'center';
  context.beginPath();
  const pixelsPerUnit = (STUDIO_EDITOR_DPI / UNITS_PER_INCH) * state.scale;
  for (const mark of editorRulerMarks(length, state.unit, pixelsPerUnit)) {
    // On the half pixel, so a one-pixel line is one pixel and not a grey two.
    const at = Math.round(mark.at) + 0.5;
    if (axis === 'x') {
      context.moveTo(at, thick);
      context.lineTo(at, thick - mark.size);
      if (mark.label !== undefined) context.fillText(mark.label, at, NUMBER_ACROSS_PX);
      continue;
    }
    context.moveTo(thick, at);
    context.lineTo(thick - mark.size, at);
    if (mark.label === undefined) continue;
    // Read from below, as the numbers down a ruler's side are.
    context.save();
    context.translate(NUMBER_ACROSS_PX, at);
    context.rotate(-Math.PI / 2);
    context.fillText(mark.label, 0, 0);
    context.restore();
  }
  context.stroke();

  context.beginPath();
  context.strokeStyle = RULER_EDGE;
  if (axis === 'x') {
    context.moveTo(0, thick - 0.5);
    context.lineTo(length, thick - 0.5);
  } else {
    context.moveTo(thick - 0.5, 0);
    context.lineTo(thick - 0.5, length);
  }
  context.stroke();

  // ⚠ Exactly where the library drew them: its dragging starts within 7 px of each margin, drawn or not.
  context.fillStyle = RULER_HANDLE;
  for (const at of [before, length - after]) {
    context.beginPath();
    if (axis === 'x') {
      context.moveTo(at - HANDLE_HALF_PX, thick - HANDLE_DEEP_PX);
      context.lineTo(at + HANDLE_HALF_PX, thick - HANDLE_DEEP_PX);
      context.lineTo(at, thick);
    } else {
      context.moveTo(thick - HANDLE_DEEP_PX, at - HANDLE_HALF_PX);
      context.lineTo(thick - HANDLE_DEEP_PX, at + HANDLE_HALF_PX);
      context.lineTo(thick, at);
    }
    context.closePath();
    context.fill();
  }
}

/** Fill `from`–`to` along a ruler, across its whole thickness. */
function fillBand(context: CanvasRenderingContext2D, axis: 'x' | 'y', from: number, to: number, thick: number): void {
  if (axis === 'x') context.fillRect(from, 0, to - from, thick);
  else context.fillRect(0, from, thick, to - from);
}
