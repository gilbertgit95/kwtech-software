import type { StudioRect, StudioSize } from './layout.js';
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
 *
 * ## Free placement — the exception, off by default
 *
 * Now and then the cover rule is in the way: a photo wanted smaller than its
 * cell, or off to one side of it (the operator, 2026-10-06). A frame marked
 * `free` is not held to covering: the WHOLE kept part of the photo is placed,
 * at any size down to `STUDIO_FREE_ZOOM_MIN`, wherever in the cell it is
 * dragged — past its own edge too, leaving white paper in the cell.
 *
 * ⚠ THE CELL STILL CUTS IT. Only the photo is free, never the layout: what
 * falls outside the cell is not drawn, so a free photo can never cover a
 * neighbour or the margin. Off unless the person turns it on for a cell, so
 * the cover rule above stays what happens without thinking.
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
  /**
   * 1 fills the cell exactly; more zooms in. Never less in a covering frame:
   * that would leave a bar. A free frame may go down to `STUDIO_FREE_ZOOM_MIN`.
   */
  zoom: number;
  /**
   * Covering: where in the slack the kept part sits, −1 to 1 on each axis. 0
   * is centred; −1 keeps the left (or top) edge, 1 the right (or bottom).
   *
   * Free: where the photo's centre sits from the cell's centre, in the cell's
   * own widths and heights, on the sheet's axes. 0.5 is half a cell right.
   */
  offsetX: number;
  offsetY: number;
  rotation: StudioRotation;
  /** Free placement (see above). Absent means covering, the default. */
  free?: boolean;
}

export const DEFAULT_FRAME: StudioFrame = { zoom: 1, offsetX: 0, offsetY: 0, rotation: 0 };

export const STUDIO_ZOOM_MAX = 8;

/** How small a freely placed photo may get: 1% of covering its cell. Smaller is a dot nobody can press. */
export const STUDIO_FREE_ZOOM_MIN = 0.01;

/**
 * How far, in cells, a free photo's centre may be from its cell's. Only a
 * bound on a value from anywhere; while it is moved, `keepInCell` holds it
 * far tighter.
 */
const STUDIO_FREE_OFFSET_MAX = 100;

/**
 * How much of a free photo stays in its cell however far it is dragged, on
 * each axis: half the photo, or half the cell when the photo is the larger.
 * A smaller photo can then sit with its centre on the cell's edge; a larger
 * one can bring its own edge to the cell's middle. Less, and a photo pushed
 * into a corner was a sliver nobody could see to drag back (seen 2026-10-06).
 */
const STUDIO_FREE_KEEP_SHARE = 0.5;

/** A rectangle of source pixels, in the photo's own (unrotated) pixel grid. */
export interface StudioSourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A frame as it arrives from a control, kept inside what is meaningful. */
export function clampFrame(frame: StudioFrame): StudioFrame {
  if (frame.free) {
    return {
      zoom: clamp(frame.zoom, STUDIO_FREE_ZOOM_MIN, STUDIO_ZOOM_MAX),
      // ⚠ NaN is centred here, not an edge: a free offset's "low" is a hundred cells away.
      offsetX: Number.isNaN(frame.offsetX) ? 0 : clamp(frame.offsetX, -STUDIO_FREE_OFFSET_MAX, STUDIO_FREE_OFFSET_MAX),
      offsetY: Number.isNaN(frame.offsetY) ? 0 : clamp(frame.offsetY, -STUDIO_FREE_OFFSET_MAX, STUDIO_FREE_OFFSET_MAX),
      rotation: frame.rotation,
      free: true,
    };
  }
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

/** The smallest zoom a frame may have: filling the cell, unless it is placed freely. */
export function zoomFloor(frame: StudioFrame): number {
  return frame.free ? STUDIO_FREE_ZOOM_MIN : 1;
}

/** The frame zoomed by a step (the buttons and the keys), to the hundredth, inside what it may be. */
export function zoomFrameBy(frame: StudioFrame, by: number): StudioFrame {
  const zoom = Math.round((frame.zoom + by) * 100) / 100;
  return { ...frame, zoom: clamp(zoom, zoomFloor(frame), STUDIO_ZOOM_MAX) };
}

/** Back to the start: centred and filling the cell, unturned. A free frame stays free — the switch is separate. */
export function resetFrame(frame: StudioFrame): StudioFrame {
  return frame.free ? { ...DEFAULT_FRAME, free: true } : DEFAULT_FRAME;
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
  // ⚠ ALWAYS AS A COVERING FRAME. A free frame draws the whole crop (`freeRect`); asked here, it is covering.
  const framed = clampFrame({ ...frame, free: false });
  const cropX = kept.x * image.width;
  const cropY = kept.y * image.height;
  const cropWidth = kept.width * image.width;
  const cropHeight = kept.height * image.height;

  const aspect = cellAspect(cell, framed.rotation);
  // The largest rectangle of that aspect inside the crop, then zoomed in.
  const width = coverWidth(image, cell, framed.rotation, kept) / framed.zoom;
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
  /*
   * Free, the offsets are the photo's centre on the sheet's own axes, in cells:
   * the hand's movement is added as it is, whatever the turn or the mirroring.
   * No slack to stop at — the caller keeps it in the cell (`keepInCell`).
   */
  if (frame.free) {
    const free = clampFrame(frame);
    return clampFrame({ ...free, offsetX: free.offsetX + move.dx, offsetY: free.offsetY + move.dy });
  }
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
  const framed = clampFrame(frame);
  // The source pixels across the cell — for a free frame shrunk below 1, more pixels than the photo has across it.
  const across = coverWidth(image, cell, framed.rotation, clampCrop(crop)) / framed.zoom;
  const sideways = framed.rotation === 90 || framed.rotation === 270;
  // Sideways, the source's width runs down the cell's height.
  const printed = sideways ? cell.height : cell.width;
  return (across * UNITS_PER_INCH) / printed;
}

/**
 * Where a FREELY placed photo lies, before its cell cuts it: the whole kept
 * part, turned, as a rectangle on the sheet's axes, in whatever units `cell` is given in (units
 * for the overlay, pixels for the renderer).
 *
 * At zoom 1 it is exactly as large as a covering frame would draw it, so
 * turning free placement on changes nothing until the photo is moved.
 */
export function freeRect(
  image: StudioSize,
  cell: StudioRect,
  frame: StudioFrame,
  crop: StudioCrop = FULL_CROP,
): StudioRect {
  const framed = clampFrame({ ...frame, free: true });
  const kept = clampCrop(crop);
  const scale = freeScale(image, cell, framed, kept);
  const sideways = framed.rotation === 90 || framed.rotation === 270;
  const ownWidth = kept.width * image.width * scale;
  const ownHeight = kept.height * image.height * scale;
  const width = sideways ? ownHeight : ownWidth;
  const height = sideways ? ownWidth : ownHeight;
  const centreX = cell.x + cell.width / 2 + framed.offsetX * cell.width;
  const centreY = cell.y + cell.height / 2 + framed.offsetY * cell.height;
  return { x: centreX - width / 2, y: centreY - height / 2, width, height };
}

/**
 * A free frame moved no further than leaves half of the photo in its cell
 * (`STUDIO_FREE_KEEP_SHARE`), so it can go past the cell's edge but never be
 * lost out of it. A covering frame is returned as it is: its slack holds it.
 */
export function keepInCell(
  image: StudioSize,
  cell: StudioSize,
  frame: StudioFrame,
  crop: StudioCrop = FULL_CROP,
): StudioFrame {
  if (!frame.free || !(cell.width > 0) || !(cell.height > 0)) return frame;
  const placed = freeRect(image, { x: 0, y: 0, ...cell }, frame, crop);
  // The furthest the photo's centre may be from the cell's, in cells, on each axis.
  const reach = (cellSide: number, photoSide: number): number =>
    ((cellSide + photoSide) / 2 - STUDIO_FREE_KEEP_SHARE * Math.min(cellSide, photoSide)) / cellSide;
  const reachX = reach(cell.width, placed.width);
  const reachY = reach(cell.height, placed.height);
  return {
    ...frame,
    offsetX: clamp(frame.offsetX, -reachX, reachX),
    offsetY: clamp(frame.offsetY, -reachY, reachY),
  };
}

/**
 * The frame with free placement turned on or off, WITHOUT THE PHOTO JUMPING:
 * the same size and the same spot, said the other way.
 *
 * On is exact. Off can only be as close as covering allows — a photo shrunk
 * below its cell grows back to fill it, and one moved past the edge of its
 * own slack stops at that edge.
 */
export function setFreePlacement(
  image: StudioSize,
  cell: StudioSize,
  frame: StudioFrame,
  free: boolean,
  crop: StudioCrop = FULL_CROP,
  flip: { horizontal: boolean; vertical: boolean } = { horizontal: false, vertical: false },
): StudioFrame {
  if (Boolean(frame.free) === free) return frame;
  const kept = clampCrop(crop);
  const cropCentreX = (kept.x + kept.width / 2) * image.width;
  const cropCentreY = (kept.y + kept.height / 2) * image.height;

  if (free) {
    const framed = clampFrame(frame);
    const source = sourceRect(image, cell, framed, kept);
    // The photo's centre from the cell's, in source pixels on the photo's own axes, then onto the sheet.
    const own = { x: cropCentreX - (source.x + source.width / 2), y: cropCentreY - (source.y + source.height / 2) };
    const onSheet = ownToSheet(own, framed.rotation, flip);
    const scale = freeScale(image, cell, framed, kept);
    return clampFrame({
      ...framed,
      offsetX: (onSheet.x * scale) / cell.width,
      offsetY: (onSheet.y * scale) / cell.height,
      free: true,
    });
  }

  const loose = clampFrame(frame);
  const scale = freeScale(image, cell, loose, kept);
  const covering = clampFrame({ zoom: loose.zoom, offsetX: 0, offsetY: 0, rotation: loose.rotation });
  // Covering asks for at least 1; the slack is measured at the zoom it will have.
  const centred = sourceRect(image, cell, covering, kept);
  const own = sheetToOwn(
    { x: (loose.offsetX * cell.width) / scale, y: (loose.offsetY * cell.height) / scale },
    loose.rotation,
    flip,
  );
  const slackX = kept.width * image.width - centred.width;
  const slackY = kept.height * image.height - centred.height;
  // `sourceRect` puts the source's centre at the crop's plus slack/2 × the move; the photo's centre is the opposite way.
  const moveX = slackX > 0.001 ? (-2 * own.x) / slackX : 0;
  const moveY = slackY > 0.001 ? (-2 * own.y) / slackY : 0;
  return clampFrame({ ...covering, ...offsetOnCell(moveX, moveY, loose.rotation) });
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

/** The inverse of `offsetInSource`: a move in the photo's own grid as the cell's left/right and up/down. */
function offsetOnCell(moveX: number, moveY: number, rotation: StudioRotation): { offsetX: number; offsetY: number } {
  switch (rotation) {
    case 0:
      return { offsetX: moveX, offsetY: moveY };
    case 90:
      return { offsetX: -moveY, offsetY: moveX };
    case 180:
      return { offsetX: -moveX, offsetY: -moveY };
    case 270:
      return { offsetX: moveY, offsetY: -moveX };
  }
}

/**
 * A distance on the photo's own axes as one on the sheet's — what the
 * renderer's mirror-then-turn does to it (`draw-sheet.ts`: scale, then rotate;
 * a canvas turn is clockwise, y pointing down).
 */
function ownToSheet(
  own: { x: number; y: number },
  rotation: StudioRotation,
  flip: { horizontal: boolean; vertical: boolean },
): { x: number; y: number } {
  const turned = turn(own, rotation);
  return { x: flip.horizontal ? -turned.x : turned.x, y: flip.vertical ? -turned.y : turned.y };
}

/** The inverse of `ownToSheet`. */
function sheetToOwn(
  onSheet: { x: number; y: number },
  rotation: StudioRotation,
  flip: { horizontal: boolean; vertical: boolean },
): { x: number; y: number } {
  const unmirrored = { x: flip.horizontal ? -onSheet.x : onSheet.x, y: flip.vertical ? -onSheet.y : onSheet.y };
  return turn(unmirrored, ((360 - rotation) % 360) as StudioRotation);
}

function turn(point: { x: number; y: number }, rotation: StudioRotation): { x: number; y: number } {
  switch (rotation) {
    case 0:
      return point;
    case 90:
      return { x: -point.y, y: point.x };
    case 180:
      return { x: -point.x, y: -point.y };
    case 270:
      return { x: point.y, y: -point.x };
  }
}

/** The cell's aspect ratio as the unrotated photo sees it. */
function cellAspect(cell: StudioSize, rotation: StudioRotation): number {
  const sideways = rotation === 90 || rotation === 270;
  return sideways ? cell.height / cell.width : cell.width / cell.height;
}

/** The width, in source pixels, of the largest rectangle of the cell's shape inside the crop: what zoom 1 shows. */
function coverWidth(image: StudioSize, cell: StudioSize, rotation: StudioRotation, kept: StudioCrop): number {
  const aspect = cellAspect(cell, rotation);
  return Math.min(kept.width * image.width, kept.height * image.height * aspect);
}

/** Sheet units (or pixels — whatever `cell` is in) per source pixel, at the frame's zoom. */
function freeScale(image: StudioSize, cell: StudioSize, frame: StudioFrame, kept: StudioCrop): number {
  const sideways = frame.rotation === 90 || frame.rotation === 270;
  // The cell's length along the photo's own width.
  const along = sideways ? cell.height : cell.width;
  return (frame.zoom * along) / coverWidth(image, cell, frame.rotation, kept);
}

function clamp(value: number, low: number, high: number): number {
  if (Number.isNaN(value)) return low;
  return Math.min(Math.max(value, low), high);
}
