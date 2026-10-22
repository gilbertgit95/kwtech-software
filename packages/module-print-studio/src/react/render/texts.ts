'use client';

import { applyCalibration, type StudioCalibration } from '../../domain/calibration.js';
import { printableArea, type StudioLayoutSpec, type StudioSize, sheetSize, textsOf } from '../../domain/layout.js';
import {
  fontFamilyOf,
  STUDIO_FONT_WEIGHT_CSS,
  STUDIO_TEXT_LINE_HEIGHT,
  type StudioText,
  textHeight,
  textLines,
} from '../../domain/texts.js';
import { UNITS_PER_INCH } from '../../domain/units.js';

/**
 * A layout's texts: measured for the editor, and drawn onto a sheet.
 *
 * ⚠ ONE FONT STRING FOR BOTH (`textFont`): the editor's SVG and the sheet's
 * canvas ask the browser for the same family, weight and style, and both put
 * each line's MIDDLE at the same height (`lineMiddle`) — so a text dragged
 * against a cell's edge in the editor prints against that edge.
 */

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The CSS `font` of a text at a size in pixels (or in units, for measuring). */
export function textFont(text: Pick<StudioText, 'font' | 'weight' | 'italic'>, size: number): string {
  return `${text.italic ? 'italic ' : ''}${STUDIO_FONT_WEIGHT_CSS[text.weight]} ${size}px ${fontFamilyOf(text.font)}`;
}

/** Where line `index`'s middle is, below the text's top, as a share of its font size. */
export function lineMiddle(index: number): number {
  return (index + 0.5) * STUDIO_TEXT_LINE_HEIGHT;
}

/**
 * The lines drawn under and through a text, each as where its top is below
 * the line's middle and how thick it is — both shares of the font size.
 *
 * ⚠ DRAWN AS RECTANGLES BY THE STUDIO, not as CSS `text-decoration`: a canvas
 * has no underline, and the browser's own would sit wherever that font says,
 * so the editor and the paper would disagree. These are the same numbers in both.
 */
export function textDecorations(text: Pick<StudioText, 'underline' | 'strike'>): { top: number; thickness: number }[] {
  const thickness = 0.06;
  return [...(text.underline ? [{ top: 0.4, thickness }] : []), ...(text.strike ? [{ top: 0.02, thickness }] : [])];
}

let measurer: Canvas2D | null | undefined;

/** A context nobody sees, kept for measuring. Null where there is no canvas (rendering on the server). */
function measuringContext(): Canvas2D | null {
  if (measurer !== undefined) return measurer;
  if (typeof OffscreenCanvas !== 'undefined') measurer = new OffscreenCanvas(1, 1).getContext('2d');
  else if (typeof document !== 'undefined') measurer = document.createElement('canvas').getContext('2d');
  else measurer = null;
  return measurer;
}

/**
 * How much room a text takes, in units: its widest line, and its lines at the
 * line height. Measured with the font at its size IN UNITS as pixels — width
 * grows with size, so no conversion is needed.
 *
 * Without a canvas (the server's first render) it is estimated at about half
 * an em a character; the browser measures it properly as soon as it draws.
 */
export function measureText(text: Pick<StudioText, 'text' | 'size' | 'font' | 'weight' | 'italic'>): StudioSize {
  return { width: Math.ceil(Math.max(0, ...lineWidths(text))), height: textHeight(text) };
}

/** How wide each line of a text is, in units — how long its underline is. */
export function lineWidths(text: Pick<StudioText, 'text' | 'size' | 'font' | 'weight' | 'italic'>): number[] {
  const context = measuringContext();
  if (context) context.font = textFont(text, text.size);
  return textLines(text).map((line) =>
    context ? context.measureText(line).width : [...line].length * text.size * 0.55,
  );
}

/**
 * Every text of a layout onto a sheet being drawn at `dpi`, over the photos
 * and the border.
 *
 * Moved by the calibration profile like a cell's corner, so a text keeps its
 * place beside the cells on a printer that shifts; its size is not scaled,
 * as a correction of a percent or two is no change anyone reads in a letter.
 *
 * ⚠ CUT AT THE PRINTABLE AREA: what runs past it is in the margin, which the
 * printer cannot reach, and printing half a letter there is worse than none.
 */
export function drawTexts(context: Canvas2D, spec: StudioLayoutSpec, dpi: number, calibration: StudioCalibration) {
  const texts = textsOf(spec);
  if (texts.length === 0) return;
  const sheet = sheetSize(spec);
  const area = printableArea(spec);
  const pixels = (units: number) => (units * dpi) / UNITS_PER_INCH;

  context.save();
  context.beginPath();
  context.rect(pixels(area.x), pixels(area.y), pixels(area.width), pixels(area.height));
  context.clip();
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  for (const text of texts) {
    const at = applyCalibration({ x: text.x + area.x, y: text.y + area.y, width: 0, height: 0 }, sheet, calibration);
    const size = pixels(text.size);
    context.font = textFont(text, size);
    // The text's own ink: printed, not a surface of the app, so never a theme token.
    context.fillStyle = text.color;
    const lines = textLines(text);
    const decorations = textDecorations(text);
    // Measured in units, so the lines under and through are as long here as in the editor.
    const widths = decorations.length > 0 ? lineWidths(text) : [];
    for (let index = 0; index < lines.length; index += 1) {
      const middle = pixels(at.y) + size * lineMiddle(index);
      context.fillText(lines[index] ?? '', pixels(at.x), middle);
      for (const decoration of decorations) {
        // Never thinner than a pixel, or a small text's underline vanishes on screen.
        const thickness = Math.max(size * decoration.thickness, 1);
        context.fillRect(pixels(at.x), middle + size * decoration.top, pixels(widths[index] ?? 0), thickness);
      }
    }
  }
  context.restore();
}
