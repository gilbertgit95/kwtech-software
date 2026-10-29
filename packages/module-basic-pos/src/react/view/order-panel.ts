/**
 * The widths of the full screen's resizable panels, each dragged by one edge
 * (the operator, 2026-10-29): the till's ORDER PANEL by its LEFT edge — a
 * store with long item names wants a wide order, one that rings up from the
 * grid wants the items to have the room — and the Cashier's WAITING FOR
 * PAYMENT column by its RIGHT edge (issue #23).
 *
 * The same rules as `module-app-hub`'s app list (`view/app-list.ts`), copied
 * structurally: a module never imports another. Written ONCE here, for
 * either edge (`panelWidthRules`), so the two panels can never drift apart.
 */

/** A panel's bounds and default, in pixels. */
export interface PanelWidthBounds {
  min: number;
  default: number;
  max: number;
}

/** Which edge the handle is: dragging TOWARD the panel's outside widens it. */
export type PanelEdge = 'left' | 'right';

export interface PanelWidthRules {
  bounds: PanelWidthBounds;
  edge: PanelEdge;
  clamp(width: number): number;
  /**
   * Reads back what was stored. Anything unreadable is the default, and a
   * width out of range is clamped rather than refused, so tightening the
   * bounds later moves a stored width inside them instead of discarding it.
   * Untrusted like everything in localStorage: a NaN width would give the
   * panel no width at all.
   */
  parseStored(raw: string | null): number;
  /** The width a drag from `fromX` to `toX` gives. */
  afterDrag(start: number, fromX: number, toX: number): number;
  /**
   * The width a key on the focused handle gives, or null when the key is not
   * the handle's. ← and → move the edge the way they point, Shift for bigger
   * steps; Home and End go to the bounds — the ARIA window splitter.
   */
  afterKey(width: number, key: string, shift: boolean): number | null;
}

export function panelWidthRules(bounds: PanelWidthBounds, edge: PanelEdge): PanelWidthRules {
  const clamp = (width: number) => Math.round(Math.min(bounds.max, Math.max(bounds.min, width)));
  // ⚠ A LEFT edge widens as the pointer moves left — the opposite of a right edge.
  const outward = edge === 'left' ? -1 : 1;
  return {
    bounds,
    edge,
    clamp,
    parseStored(raw) {
      if (!raw) return bounds.default;
      const width = Number(raw);
      return Number.isFinite(width) ? clamp(width) : bounds.default;
    },
    afterDrag(start, fromX, toX) {
      return clamp(start + outward * (toX - fromX));
    },
    afterKey(width, key, shift) {
      const step = shift ? 64 : 16;
      switch (key) {
        case 'ArrowLeft':
          return clamp(width - outward * step);
        case 'ArrowRight':
          return clamp(width + outward * step);
        case 'Home':
          return bounds.min;
        case 'End':
          return bounds.max;
        default:
          return null;
      }
    },
  };
}

/** Pixels. The default is the 22rem the panel had before it could be resized. */
export const ORDER_PANEL_WIDTH = { min: 288, default: 352, max: 720 } as const;

/**
 * Per viewer and per device, so localStorage and not a store setting: how
 * wide the order should be depends on the screen in front of you, and one
 * cashier's taste must not resize every till.
 */
export const ORDER_PANEL_STORAGE_KEY = 'kwtech:pos-order-panel-width';

export const ORDER_PANEL_RULES = panelWidthRules(ORDER_PANEL_WIDTH, 'left');

export function clampOrderPanelWidth(width: number): number {
  return ORDER_PANEL_RULES.clamp(width);
}

export function parseStoredOrderPanelWidth(raw: string | null): number {
  return ORDER_PANEL_RULES.parseStored(raw);
}

/** ⚠ The handle is the panel's LEFT edge, so moving the pointer LEFT widens it. */
export function orderPanelWidthAfterDrag(start: number, fromX: number, toX: number): number {
  return ORDER_PANEL_RULES.afterDrag(start, fromX, toX);
}

export function orderPanelWidthAfterKey(width: number, key: string, shift: boolean): number | null {
  return ORDER_PANEL_RULES.afterKey(width, key, shift);
}

/**
 * The Cashier's "Waiting for payment" column (issue #23), dragged by its RIGHT
 * edge. The default is the 20rem it had before it could be resized; past the
 * max, the till beside it would have no room left.
 */
export const WAITING_COLUMN_WIDTH = { min: 224, default: 320, max: 560 } as const;

/** Per viewer and per device, like the order panel's. */
export const WAITING_COLUMN_STORAGE_KEY = 'kwtech:pos-waiting-column-width';

export const WAITING_COLUMN_RULES = panelWidthRules(WAITING_COLUMN_WIDTH, 'right');
