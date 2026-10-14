/**
 * Where a popover (the select's list, the date picker's calendar) goes for its
 * trigger — pure, and tested (`test/popover.test.ts`), so the component only
 * measures and draws.
 */

/** The trigger's box in the viewport — the part of a `DOMRect` the rule reads. */
export interface PopoverAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A width and a height, in pixels: the popover's own size, or the viewport's. */
export interface PopoverSize {
  width: number;
  height: number;
}

/** Which edge of the trigger the popover lines up with. */
export type PopoverAlign = 'start' | 'end';

/** A point in the viewport for a `position: fixed` popover, and how tall it may grow there. */
export interface PopoverPlacement {
  left: number;
  top: number;
  maxHeight: number;
}

/** Pixels between the trigger and the popover. */
export const POPOVER_GAP_PX = 4;

/** Pixels kept clear between the popover and the edge of the screen. */
export const POPOVER_EDGE_PX = 8;

/**
 * Below the trigger when it fits there, or when there is more room below than
 * above; otherwise above it. Either way it is held inside the screen, and
 * `maxHeight` is the room on the side it opened on, so a long list scrolls
 * inside itself rather than running off the screen.
 *
 * ⚠ It FLIPS, unlike `tooltipPosition`: a hint's caller knows where its control
 * sits, but a select sits wherever its panel was scrolled to — the last field
 * of the task panel is at the bottom of the screen as often as not.
 */
export function popoverPlacement(
  anchor: PopoverAnchor,
  size: PopoverSize,
  viewport: PopoverSize,
  align: PopoverAlign,
): PopoverPlacement {
  const below = viewport.height - (anchor.top + anchor.height) - POPOVER_GAP_PX - POPOVER_EDGE_PX;
  const above = anchor.top - POPOVER_GAP_PX - POPOVER_EDGE_PX;
  const wanted = align === 'start' ? anchor.left : anchor.left + anchor.width - size.width;
  // The left edge wins when the popover is wider than the screen: its start is what is read first.
  const left = Math.max(POPOVER_EDGE_PX, Math.min(wanted, viewport.width - size.width - POPOVER_EDGE_PX));
  if (size.height <= below || below >= above) {
    return { left, top: anchor.top + anchor.height + POPOVER_GAP_PX, maxHeight: Math.max(below, 0) };
  }
  const height = Math.min(size.height, above);
  return { left, top: anchor.top - POPOVER_GAP_PX - height, maxHeight: Math.max(above, 0) };
}
