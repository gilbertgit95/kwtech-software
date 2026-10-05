'use client';

import { rulerLengthFor } from '../../domain/calibration.js';
import { printableArea, type StudioLayoutSpec, sheetSize } from '../../domain/layout.js';
import { inches, mm, STUDIO_RENDER_DPI, toPixels } from '../../domain/units.js';
import { canvasToJpeg, scratchCanvas, sheetPixels } from './draw-sheet.js';
import { bindSheets, type StudioResult } from './result.js';

/**
 * The ruler page: two lines of a known length, to be printed and measured with
 * a real ruler (PRINT-STUDIO-PLAN decision 21).
 *
 * What the person reads off the paper goes into a calibration profile, and the
 * studio then draws slightly larger or smaller to make up for that printer.
 *
 * Drawn UNCALIBRATED, always: it measures the printer as it is.
 */
export async function makeRulerResult(
  spec: Pick<StudioLayoutSpec, 'paper' | 'orientation' | 'margins'>,
): Promise<StudioResult> {
  const sheet = sheetSize(spec);
  const area = printableArea(spec);
  const dpi = STUDIO_RENDER_DPI;
  const size = sheetPixels({ ...spec, version: 1, cells: [], guides: false }, dpi);
  const canvas = scratchCanvas(size.width, size.height);
  const context = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('This browser could not draw the page.');
  const px = (units: number) => toPixels(units, dpi);

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size.width, size.height);
  context.strokeStyle = '#000000';
  context.fillStyle = '#000000';
  context.lineWidth = Math.max(px(mm(0.2)), 1);

  // Shorter than 100 mm on a small paper; the page says how long each line is.
  const length = rulerLengthFor(area);
  const left = area.x + mm(10);
  const top = area.y + mm(14);
  const tick = mm(2);
  const fontPx = Math.max(px(mm(3)), 10);
  context.font = `${fontPx}px sans-serif`;
  context.textBaseline = 'alphabetic';

  // The line across, with a tick every 10 mm.
  line(context, px(left), px(top), px(left + length), px(top));
  for (let at = 0; at <= length; at += mm(10)) {
    line(context, px(left + at), px(top - tick), px(left + at), px(top + tick));
  }
  context.fillText(`Across: this line is ${length / 100} mm`, px(left), px(top - mm(4)));

  // The line down.
  line(context, px(left), px(top), px(left), px(top + length));
  for (let at = 0; at <= length; at += mm(10)) {
    line(context, px(left - tick), px(top + at), px(left + tick), px(top + at));
  }
  context.save();
  context.translate(px(left - mm(4)), px(top + length));
  context.rotate(-Math.PI / 2);
  context.fillText(`Down: this line is ${length / 100} mm`, 0, 0);
  context.restore();

  // A one-inch square, when there is room for it beside the lines: a quick check by eye against a 1 × 1.
  const square = inches(1);
  if (area.width >= mm(20) + length && length >= square + mm(20)) {
    const x = left + mm(12);
    const y = top + mm(12);
    context.strokeRect(px(x), px(y), px(x + square) - px(x), px(y + square) - px(y));
    context.fillText('1 × 1 in', px(x + mm(2)), px(y + square / 2));
  }

  const notes = ['Print at 100% (actual size), not "fit to page".', 'Measure both lines and type what you read.'];
  let noteTop = top + length + mm(10);
  for (const note of notes) {
    if (noteTop < area.y + area.height) context.fillText(note, px(left), px(noteTop), px(area.width - mm(12)));
    noteTop += mm(5);
  }

  return { ...(await bindSheets(sheet, [await canvasToJpeg(canvas)], 1)), sheet };
}

function line(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}
