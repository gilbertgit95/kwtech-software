/** Which edge of the trigger the hint opens on. */
export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

/** Which part of the trigger the hint lines up with, along that edge. */
export type TooltipAlign = 'start' | 'center' | 'end';

/** The trigger's box in the viewport — the part of a `DOMRect` the rule reads. */
export interface TooltipAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A point in the viewport, and how the hint is shifted to hang off it. */
export interface TooltipPosition {
  left: number;
  top: number;
  /** A CSS `translate` value: the hint's own size is not known until it is drawn, so the shift is in percent. */
  translate: string;
}

/** Pixels between the trigger and the hint: room for the arrow. */
export const TOOLTIP_GAP_PX = 8;

/**
 * Where a hint goes for a trigger at `anchor`.
 *
 * In VIEWPORT coordinates, for a `position: fixed` hint drawn outside the
 * trigger's own container. That is the point of it: a hint positioned inside
 * its trigger is cut off by the first scrolling or clipping ancestor, which is
 * every list, rail and toolbar.
 *
 * It does not flip at the edge of the screen. The caller knows where its
 * control sits and picks the side and alignment with room.
 */
export function tooltipPosition(anchor: TooltipAnchor, side: TooltipSide, align: TooltipAlign): TooltipPosition {
  switch (side) {
    case 'top': {
      const along = alongEdge(anchor.left, anchor.width, align);
      return { left: along.at, top: anchor.top - TOOLTIP_GAP_PX, translate: `${along.shift} -100%` };
    }
    case 'bottom': {
      const along = alongEdge(anchor.left, anchor.width, align);
      return { left: along.at, top: anchor.top + anchor.height + TOOLTIP_GAP_PX, translate: `${along.shift} 0` };
    }
    case 'left': {
      const along = alongEdge(anchor.top, anchor.height, align);
      return { left: anchor.left - TOOLTIP_GAP_PX, top: along.at, translate: `-100% ${along.shift}` };
    }
    case 'right': {
      const along = alongEdge(anchor.top, anchor.height, align);
      return { left: anchor.left + anchor.width + TOOLTIP_GAP_PX, top: along.at, translate: `0 ${along.shift}` };
    }
  }
}

/** The point along an edge that the hint lines up with, and the shift that puts its matching part there. */
function alongEdge(start: number, length: number, align: TooltipAlign): { at: number; shift: string } {
  switch (align) {
    case 'start':
      return { at: start, shift: '0' };
    case 'center':
      return { at: start + length / 2, shift: '-50%' };
    case 'end':
      return { at: start + length, shift: '-100%' };
  }
}
