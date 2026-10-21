import type { StockDelta, StockItemKind, StockQuantity } from '../types.js';

/**
 * Putting back what a sold line took (INVENTORY-PLAN §3).
 *
 * ⚠ READ FROM THE LINE'S OWN MOVEMENTS, NEVER FROM TODAY'S LIST. What a line
 * took was fixed when it was recorded; a materials list edited since must not
 * change what a void or a refund puts back, or the count drifts by the
 * difference every time.
 */

/** One stock item a sold line took, with what kind of item it is. `taken` is positive. */
export interface StockTaken {
  stockItemId: string;
  kind: StockItemKind;
  taken: StockQuantity;
  /** What earlier returns of this line already put back, positive. */
  returned: StockQuantity;
}

/**
 * A VOID: the unpaid order's goods came back whole, so everything the line
 * took returns — materials too, because nothing was made or used (POS-PLAN
 * D17: voiding is for an order whose items came back). Less what was already
 * returned, so a void after a refund cannot put back twice.
 */
export function planVoidReturn(taken: readonly StockTaken[]): StockDelta[] {
  return taken
    .map((one) => ({ stockItemId: one.stockItemId, quantity: Math.max(0, one.taken - one.returned) }))
    .filter((delta) => delta.quantity > 0);
}

/**
 * A REFUND LINE PUT BACK ON THE SHELF: `units` of the line's `lineQuantity`
 * came back sellable. Only FOR-SALE stock returns; the paper a print used
 * stays used (INVENTORY-PLAN §3).
 *
 * Per unit is `taken / lineQuantity`, exact because a line took
 * `perUnit × quantity`. Capped at what is left to return, so refunding 1 and
 * then 1 of 2 never puts back three.
 */
export function planRefundReturn(taken: readonly StockTaken[], lineQuantity: number, units: number): StockDelta[] {
  if (lineQuantity <= 0 || units <= 0) return [];
  return taken
    .filter((one) => one.kind === 'for_sale')
    .map((one) => {
      const perUnit = Math.floor(one.taken / lineQuantity);
      const left = Math.max(0, one.taken - one.returned);
      return { stockItemId: one.stockItemId, quantity: Math.min(left, perUnit * units) };
    })
    .filter((delta) => delta.quantity > 0);
}
