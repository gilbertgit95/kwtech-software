import type { StudioSize } from './layout.js';
import { UNITS_PER_INCH } from './units.js';

/**
 * How a photo sits in a cell (PRINT-STUDIO-PLAN §3, step 4).
 *
 * A photo always COVERS its cell: it is scaled until the cell is full and the
 * overflow is cropped, never stretched and never letterboxed — an ID photo with
 * a white bar down one side is a reprint. What the person controls is which
 * part is kept.
 *
 * Two layers, on purpose:
 *
 *   StudioPhotoEdit — about the PHOTO: its crop, flips and lighting. Every
 *                     cell holding that photo follows.
 *   StudioFrame     — about one CELL: how the (edited) photo is zoomed, moved
 *                     and turned inside it.
 */

/** A quarter turn, clockwise. */
export type StudioRotation = 0 | 90 | 180 | 270;

export const STUDIO_ROTATIONS = [0, 90, 180, 270] as const satisfies readonly StudioRotation[];

/** The part of a photo that is kept, as FRACTIONS of its width and height (0–1), before any rotation. */
export interface StudioCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FULL_CROP: StudioCrop = { x: 0, y: 0, width: 1, height: 1 };

/** How one cell frames its photo. */
export interface StudioFrame {
  /** 1 fills the cell exactly; more zooms in. Never less: that would leave a bar. */
  zoom: number;
  /**
   * Where in the slack the kept part sits, −1 to 1 on each axis. 0 is centred;
   * −1 keeps the left (or top) edge, 1 the right (or bottom).
   */
  offsetX: number;
  offsetY: number;
  rotation: StudioRotation;
}

export const DEFAULT_FRAME: StudioFrame = { zoom: 1, offsetX: 0, offsetY: 0, rotation: 0 };

export const STUDIO_ZOOM_MAX = 8;

/** A rectangle of source pixels, in the photo's own (unrotated) pixel grid. */
export interface StudioSourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A frame as it arrives from a control, kept inside what is meaningful. */
export function clampFrame(frame: StudioFrame): StudioFrame {
  return {
    zoom: clamp(frame.zoom, 1, STUDIO_ZOOM_MAX),
    offsetX: clamp(frame.offsetX, -1, 1),
    offsetY: clamp(frame.offsetY, -1, 1),
    rotation: frame.rotation,
  };
}

/** A crop kept inside the photo and never thinner than a hundredth of it. */
export function clampCrop(crop: StudioCrop): StudioCrop {
  const width = clamp(crop.width, 0.01, 1);
  const height = clamp(crop.height, 0.01, 1);
  return { x: clamp(crop.x, 0, 1 - width), y: clamp(crop.y, 0, 1 - height), width, height };
}

/** The next quarter turn clockwise. */
export function nextRotation(rotation: StudioRotation): StudioRotation {
  switch (rotation) {
    case 0:
      return 90;
    case 90:
      return 180;
    case 180:
      return 270;
    case 270:
      return 0;
  }
}

/**
 * The source pixels of a photo that end up in a cell.
 *
 * In the photo's OWN grid, before rotation: the renderer cuts this rectangle
 * out, turns it by `frame.rotation`, and scales it to the cell. So for a
 * quarter turn the rectangle has the cell's aspect ratio on its side.
 *
 * The slack — the part of the cropped photo the cell cannot show — is what
 * `offsetX` / `offsetY` move through. They are given in the cell's own
 * left/right and up/down, so "move left" means left on the sheet whichever way
 * the photo is turned.
 */
export function sourceRect(
  image: StudioSize,
  cell: StudioSize,
  frame: StudioFrame,
  crop: StudioCrop = FULL_CROP,
): StudioSourceRect {
  const kept = clampCrop(crop);
  const framed = clampFrame(frame);
  const cropX = kept.x * image.width;
  const cropY = kept.y * image.height;
  const cropWidth = kept.width * image.width;
  const cropHeight = kept.height * image.height;

  const sideways = framed.rotation === 90 || framed.rotation === 270;
  // The cell's aspect ratio as the unrotated photo sees it.
  const aspect = sideways ? cell.height / cell.width : cell.width / cell.height;

  // The largest rectangle of that aspect inside the crop, then zoomed in.
  const fitWidth = Math.min(cropWidth, cropHeight * aspect);
  const width = fitWidth / framed.zoom;
  const height = width / aspect;

  const slackX = cropWidth - width;
  const slackY = cropHeight - height;
  const [moveX, moveY] = offsetInSource(framed);
  return {
    x: cropX + (slackX / 2) * (1 + moveX),
    y: cropY + (slackY / 2) * (1 + moveY),
    width,
    height,
  };
}

/**
 * The frame after the photo is DRAGGED inside its cell — the hand on the photo,
 * rather than two sliders.
 *
 * `move` is how far the pointer went, as fractions of the cell's own width and
 * height. The photo follows the hand: drag right and it moves right, which
 * means the cell now looks further LEFT in it. It stops at the photo's edge —
 * there is nothing past it to show — and an axis with no slack does not move
 * at all (a wide photo in a square cell cannot be dragged up or down until it
 * is zoomed).
 *
 * `flip` is the photo's own mirroring: mirrored, the hand's direction is too.
 */
export function panFrame(
  image: StudioSize,
  cell: StudioSize,
  frame: StudioFrame,
  move: { dx: number; dy: number },
  crop: StudioCrop = FULL_CROP,
  flip: { horizontal: boolean; vertical: boolean } = { horizontal: false, vertical: false },
): StudioFrame {
  const framed = clampFrame(frame);
  const kept = clampCrop(crop);
  const source = sourceRect(image, cell, framed, kept);
  const cropWidth = kept.width * image.width;
  const cropHeight = kept.height * image.height;
  const sideways = framed.rotation === 90 || framed.rotation === 270;

  // What the cell's width and height show of the source, and how much more of it there is each way.
  const across = sideways ? source.height : source.width;
  const down = sideways ? source.width : source.height;
  const slackAcross = (sideways ? cropHeight - source.height : cropWidth - source.width) / across;
  const slackDown = (sideways ? cropWidth - source.width : cropHeight - source.height) / down;

  const step = (offset: number, moved: number, slack: number, mirrored: boolean): number => {
    // A thousandth of the cell: less is rounding, not room to move.
    if (!(slack > 0.001)) return offset;
    const direction = mirrored ? 1 : -1;
    return clamp(offset + (direction * moved * 2) / slack, -1, 1);
  };
  return {
    ...framed,
    offsetX: step(framed.offsetX, move.dx, slackAcross, flip.horizontal),
    offsetY: step(framed.offsetY, move.dy, slackDown, flip.vertical),
  };
}

/**
 * The resolution a photo will actually print at in a cell, in dots per inch:
 * the source pixels across the cell over the cell's printed width.
 *
 * Below `STUDIO_BLURRY_DPI` the studio warns — the photo looks fine on a
 * screen and soft on paper, and the customer sees it only after paying.
 */
export function effectiveDpi(
  image: StudioSize,
  cell: StudioSize,
  frame: StudioFrame,
  crop: StudioCrop = FULL_CROP,
): number {
  const source = sourceRect(image, cell, frame, crop);
  const sideways = frame.rotation === 90 || frame.rotation === 270;
  // Sideways, the source's width runs down the cell's height.
  const printed = sideways ? cell.height : cell.width;
  return (source.width * UNITS_PER_INCH) / printed;
}

/**
 * The cell's left/right and up/down offsets as movement in the photo's own
 * grid. A photo turned a quarter clockwise has its own "up" pointing right on
 * the sheet, so the axes swap and one of them flips.
 */
function offsetInSource(frame: StudioFrame): [number, number] {
  switch (frame.rotation) {
    case 0:
      return [frame.offsetX, frame.offsetY];
    case 90:
      return [frame.offsetY, -frame.offsetX];
    case 180:
      return [-frame.offsetX, -frame.offsetY];
    case 270:
      return [-frame.offsetY, frame.offsetX];
  }
}

function clamp(value: number, low: number, high: number): number {
  if (Number.isNaN(value)) return low;
  return Math.min(Math.max(value, low), high);
}
