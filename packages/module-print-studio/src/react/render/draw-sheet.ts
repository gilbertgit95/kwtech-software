'use client';

import { adjustPixels, isNeutralLighting } from '../../domain/adjust.js';
import { borderSegments } from '../../domain/border.js';
import { applyCalibration, type StudioCalibration } from '../../domain/calibration.js';
import type { StudioPageFill } from '../../domain/fill.js';
import { borderOf, cellOnSheet, type StudioLayoutSpec, type StudioRect, sheetSize } from '../../domain/layout.js';
import { sourceRect } from '../../domain/slot-fit.js';
import { toPixels } from '../../domain/units.js';
import { frameOf, NO_PHOTO_EDIT, type StudioFrames, type StudioPhotoEdit } from '../view/work.js';
import type { StudioPhoto } from './photos.js';

/**
 * One sheet, drawn to a canvas.
 *
 * ⚠ THE PREVIEW AND THE RESULT ARE THIS ONE FUNCTION at two resolutions. There
 * is no second renderer for the screen, so there is nothing the screen can
 * show that the paper will not.
 *
 * Every position comes from the domain in hundredths of a millimetre and is
 * turned into pixels here, edge by edge (`pixelRect`).
 */
export interface DrawSheetInput {
  spec: StudioLayoutSpec;
  /** Which photo is in each cell of this page, by the cell's index. */
  page: StudioPageFill;
  /** This page's number among the pages, to look its cells' frames up. */
  pageIndex: number;
  frames: StudioFrames;
  photos: ReadonlyMap<string, StudioPhoto>;
  edits: ReadonlyMap<string, StudioPhotoEdit>;
  calibration: StudioCalibration;
  /** Dots per inch. 300 for the result; whatever fits the screen for the preview. */
  dpi: number;
  /** Draw from each photo's small preview copy. True on screen, false for the result. */
  usePreview: boolean;
}

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Paper. Literal, not a theme token: the sheet is a picture of paper, the same in every theme. */
const PAPER = '#ffffff';
/**
 * The border's two shades. Literal, like the paper: this is ink on a sheet, not a surface of the app.
 * Grey shows on white and disappears under the blade; black is for pale designs.
 */
const BORDER_COLORS = { grey: '#9ca3af', black: '#000000' } as const;

/** The pixel size of a sheet at a resolution — what the canvas must be before `drawSheet`. */
export function sheetPixels(spec: StudioLayoutSpec, dpi: number): { width: number; height: number } {
  const sheet = sheetSize(spec);
  return { width: Math.max(toPixels(sheet.width, dpi), 1), height: Math.max(toPixels(sheet.height, dpi), 1) };
}

export function drawSheet(context: Canvas2D, input: DrawSheetInput): void {
  const { spec, dpi } = input;
  const sheet = sheetSize(spec);
  const size = sheetPixels(spec, dpi);

  context.save();
  context.fillStyle = PAPER;
  context.fillRect(0, 0, size.width, size.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  const rects = spec.cells.map((cell) =>
    pixelRect(applyCalibration(cellOnSheet(spec, cell), sheet, input.calibration), dpi),
  );

  for (let index = 0; index < spec.cells.length; index += 1) {
    const cell = spec.cells[index];
    const rect = rects[index];
    const photoId = input.page[index];
    const photo = photoId ? input.photos.get(photoId) : undefined;
    if (!cell || !rect || !photo || rect.width < 1 || rect.height < 1) continue;
    drawPhoto(context, input, photo, index, cell, rect);
  }

  if (spec.guides) {
    const border = borderOf(spec);
    context.strokeStyle = BORDER_COLORS[border.color];
    // Never thinner than a pixel: a hairline must still show on screen.
    const width = Math.max(toPixels(border.width, dpi), 1);
    context.lineWidth = width;
    // Dashes as long as six lines and gaps of four — but never under 1.5 mm, or a hairline's dashes read as dots.
    const dash = Math.max(width * 6, toPixels(150, dpi));
    context.setLineDash(border.style === 'dashed' ? [dash, dash * 0.66] : []);
    /*
     * ⚠ CENTRED ON THE CELL'S EDGE: half the line falls inside the photo and
     * half outside. A blade down the middle of the line then cuts the photo
     * to its exact size, whatever the line's thickness.
     */
    // Each edge once (`borderSegments`): a shared edge drawn twice turns a dashed line solid.
    context.lineCap = 'butt';
    context.beginPath();
    for (const segment of borderSegments(rects)) {
      context.moveTo(segment.x1, segment.y1);
      context.lineTo(segment.x2, segment.y2);
    }
    context.stroke();
    context.setLineDash([]);
  }
  context.restore();
}

/**
 * A rectangle in units as whole pixels.
 *
 * ⚠ EACH EDGE IS ROUNDED ON ITS OWN, and the width is the difference. Rounding
 * the width instead lets two cells that touch in units end up a pixel apart or
 * a pixel over each other.
 */
function pixelRect(rect: StudioRect, dpi: number): StudioRect {
  const left = toPixels(rect.x, dpi);
  const top = toPixels(rect.y, dpi);
  return {
    x: left,
    y: top,
    width: toPixels(rect.x + rect.width, dpi) - left,
    height: toPixels(rect.y + rect.height, dpi) - top,
  };
}

/**
 * One photo into one cell: cut the source rectangle, turn and flip it, light
 * it, and place it.
 *
 * Drawn on a scratch canvas the size of the cell first, because lighting is
 * arithmetic on pixels (`adjustPixels`) and must touch this cell's pixels only.
 */
function drawPhoto(
  context: Canvas2D,
  input: DrawSheetInput,
  photo: StudioPhoto,
  index: number,
  cell: { width: number; height: number },
  rect: StudioRect,
): void {
  const frame = frameOf(input.frames, input.pageIndex, index);
  const edit = input.edits.get(photo.id) ?? NO_PHOTO_EDIT;
  const source = sourceRect(photo, cell, frame, edit.crop);
  const bitmap = input.usePreview ? photo.preview : photo.bitmap;
  // The preview copy is smaller: the same rectangle, in its pixels.
  const shrink = bitmap.width / photo.width;

  const scratch = scratchCanvas(rect.width, rect.height);
  const draw = scratch.getContext('2d', { willReadFrequently: true }) as Canvas2D | null;
  if (!draw) return;
  draw.imageSmoothingEnabled = true;
  draw.imageSmoothingQuality = 'high';

  const sideways = frame.rotation === 90 || frame.rotation === 270;
  const across = sideways ? rect.height : rect.width;
  const down = sideways ? rect.width : rect.height;
  draw.save();
  draw.translate(rect.width / 2, rect.height / 2);
  // Flips mirror what the cell shows, so they come first; then the quarter turn.
  draw.scale(edit.flipH ? -1 : 1, edit.flipV ? -1 : 1);
  draw.rotate((frame.rotation * Math.PI) / 180);
  draw.drawImage(
    bitmap,
    source.x * shrink,
    source.y * shrink,
    source.width * shrink,
    source.height * shrink,
    -across / 2,
    -down / 2,
    across,
    down,
  );
  draw.restore();

  if (!isNeutralLighting(edit.lighting)) {
    const pixels = draw.getImageData(0, 0, rect.width, rect.height);
    adjustPixels(pixels.data, edit.lighting);
    draw.putImageData(pixels, 0, 0);
  }
  context.drawImage(scratch, rect.x, rect.y);
}

/** A canvas nobody sees. `OffscreenCanvas` where there is one; an unattached element otherwise. */
export function scratchCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** A canvas as a JPEG. Near-lossless: these are photographs about to be printed. */
export async function canvasToJpeg(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  const quality = 0.95;
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The page could not be drawn.'))),
      'image/jpeg',
      quality,
    );
  });
}
