import type { StudioRect, StudioSize } from './layout.js';
import { mm } from './units.js';

/**
 * A picture behind everything on the sheet, for ONE PRINT (the operator,
 * 2026-10-22, issue #12): a design, a pattern, a faded logo under the photos.
 * Chosen on the Print screen, moved and resized there, and made fainter with
 * its opacity. Never part of a layout and never saved: like the photos, it
 * lives in the tab and is gone with Start over.
 *
 * ⚠ THE RECTANGLE IS IN SHEET COORDINATES — from the paper's top left, not the
 * printable area's — and MAY HANG PAST THE SHEET: a picture enlarged to fill a
 * page is cut by the page, as a photo is cut by its cell. The renderer cuts it
 * at the printable area, which is all the printer can reach.
 *
 * Its shape is always the picture's own (`resizeBackground`): stretching a
 * design out of shape is never what anyone wants on paper.
 */
export interface StudioBackground {
  rect: StudioRect;
  /** How strongly it prints: 0 is not at all, 100 is as it is. Whole percent. */
  opacity: number;
}

/** How a picture is fitted to the page: covering all of it (cut at the edges), or wholly inside it. Not the written document's `StudioBackgroundFit`, which canvas-editor reads. */
export type StudioBackgroundSizing = 'fill' | 'fit';

/** How much of a picture must stay on the sheet when it is dragged: 5 mm, so it can always be found and taken back. */
export const STUDIO_BACKGROUND_VISIBLE_MIN = mm(5);
/** The narrowest a picture may be made: 5 mm. */
export const STUDIO_BACKGROUND_WIDTH_MIN = mm(5);
/** The widest, as a multiple of the sheet's own width: far enough to blow up a detail, not so far it is lost. */
export const STUDIO_BACKGROUND_SCALE_MAX = 4;

/** The picture's height for a width, at its own shape. `image` is its size in pixels. */
function heightFor(width: number, image: StudioSize): number {
  return Math.round((width * image.height) / Math.max(image.width, 1));
}

/**
 * A picture fitted to a box (the printable area), centred: `fill` covers the
 * whole box and is cut at its edges; `fit` shows all of it inside the box.
 */
export function fitBackground(image: StudioSize, box: StudioRect, how: StudioBackgroundSizing): StudioRect {
  const across = box.width / Math.max(image.width, 1);
  const down = box.height / Math.max(image.height, 1);
  const scale = how === 'fill' ? Math.max(across, down) : Math.min(across, down);
  const width = Math.max(Math.round(image.width * scale), 1);
  const height = Math.max(Math.round(image.height * scale), 1);
  return {
    x: Math.round(box.x + (box.width - width) / 2),
    y: Math.round(box.y + (box.height - height) / 2),
    width,
    height,
  };
}

/** The picture centred on a box, at the size it is. */
export function centreBackground(rect: StudioRect, box: StudioRect): StudioRect {
  return {
    ...rect,
    x: Math.round(box.x + (box.width - rect.width) / 2),
    y: Math.round(box.y + (box.height - rect.height) / 2),
  };
}

/**
 * The picture at another width, its height following at its own shape.
 *
 * `from` says what stays still: its `centre` (the size slider — the picture
 * grows evenly round where it is) or its `corner`, the top left (a drag of the
 * bottom right handle — the corner under the hand moves, nothing else).
 * Bounded by `STUDIO_BACKGROUND_WIDTH_MIN` and `STUDIO_BACKGROUND_SCALE_MAX`
 * of the sheet.
 */
export function resizeBackground(
  rect: StudioRect,
  width: number,
  image: StudioSize,
  sheet: StudioSize,
  from: 'centre' | 'corner',
): StudioRect {
  const max = Math.max(sheet.width, sheet.height) * STUDIO_BACKGROUND_SCALE_MAX;
  const nextWidth = Math.round(Math.min(Math.max(width, STUDIO_BACKGROUND_WIDTH_MIN), max));
  const nextHeight = Math.max(heightFor(nextWidth, image), 1);
  if (from === 'corner') return { x: rect.x, y: rect.y, width: nextWidth, height: nextHeight };
  return {
    x: Math.round(rect.x + (rect.width - nextWidth) / 2),
    y: Math.round(rect.y + (rect.height - nextHeight) / 2),
    width: nextWidth,
    height: nextHeight,
  };
}

/**
 * The picture moved to a top left, kept where it can still be found: at least
 * `STUDIO_BACKGROUND_VISIBLE_MIN` of it stays on the sheet each way. A drag
 * that would throw it off the paper stops at the edge instead.
 */
export function moveBackground(rect: StudioRect, to: { x: number; y: number }, sheet: StudioSize): StudioRect {
  const keepX = Math.min(STUDIO_BACKGROUND_VISIBLE_MIN, rect.width);
  const keepY = Math.min(STUDIO_BACKGROUND_VISIBLE_MIN, rect.height);
  return {
    ...rect,
    x: Math.round(Math.min(Math.max(to.x, keepX - rect.width), sheet.width - keepX)),
    y: Math.round(Math.min(Math.max(to.y, keepY - rect.height), sheet.height - keepY)),
  };
}

/** An opacity as whole percent, 0 to 100, whatever a slider or a key asked for. */
export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(Math.max(Math.round(value), 0), 100);
}

/** A new background: the picture filling the printable area, at full strength. */
export function newBackground(image: StudioSize, area: StudioRect): StudioBackground {
  return { rect: fitBackground(image, area, 'fill'), opacity: 100 };
}
