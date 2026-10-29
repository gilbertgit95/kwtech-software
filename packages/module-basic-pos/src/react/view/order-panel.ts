/**
 * The width of the till's order panel on the full screen, which the cashier
 * drags by its LEFT edge (the operator, 2026-10-29): a store with long item
 * names and many lines wants a wide order, a store that rings up from the
 * grid wants the items to have the room.
 *
 * The same rules as `module-app-hub`'s app list (`view/app-list.ts`), copied
 * structurally: a module never imports another.
 */

/** Pixels. The default is the 22rem the panel had before it could be resized. */
export const ORDER_PANEL_WIDTH = { min: 288, default: 352, max: 720 } as const;

/**
 * Per viewer and per device, so localStorage and not a store setting: how
 * wide the order should be depends on the screen in front of you, and one
 * cashier's taste must not resize every till.
 */
export const ORDER_PANEL_STORAGE_KEY = 'kwtech:pos-order-panel-width';

export function clampOrderPanelWidth(width: number): number {
  return Math.round(Math.min(ORDER_PANEL_WIDTH.max, Math.max(ORDER_PANEL_WIDTH.min, width)));
}

/**
 * Reads back what was stored. Anything unreadable is the default, and a width
 * out of range is clamped rather than refused, so tightening the bounds later
 * moves a stored width inside them instead of discarding it.
 *
 * Untrusted like everything in localStorage: a NaN width would give the panel
 * no width at all.
 */
export function parseStoredOrderPanelWidth(raw: string | null): number {
  if (!raw) return ORDER_PANEL_WIDTH.default;
  const width = Number(raw);
  return Number.isFinite(width) ? clampOrderPanelWidth(width) : ORDER_PANEL_WIDTH.default;
}

/**
 * The width a drag gives. ⚠ The handle is the panel's LEFT edge, so moving
 * the pointer LEFT widens it — the opposite of the app list's right edge.
 */
export function orderPanelWidthAfterDrag(start: number, fromX: number, toX: number): number {
  return clampOrderPanelWidth(start - (toX - fromX));
}

/**
 * The width a key on the focused handle gives, or null when the key is not
 * the handle's. ← and → move the edge the way they point (← widens), Shift
 * for bigger steps; Home and End go to the bounds — the ARIA window splitter.
 */
export function orderPanelWidthAfterKey(width: number, key: string, shift: boolean): number | null {
  const step = shift ? 64 : 16;
  switch (key) {
    case 'ArrowLeft':
      return clampOrderPanelWidth(width + step);
    case 'ArrowRight':
      return clampOrderPanelWidth(width - step);
    case 'Home':
      return ORDER_PANEL_WIDTH.min;
    case 'End':
      return ORDER_PANEL_WIDTH.max;
    default:
      return null;
  }
}
