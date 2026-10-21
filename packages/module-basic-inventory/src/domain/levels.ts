import type { StockDelta, StockLevel, StockQuantity, StockRefusal } from '../types.js';
import { isStockQuantity } from './quantities.js';

/**
 * On hand, and how an item stands (INVENTORY-PLAN §3).
 *
 * ⚠ ON HAND IS ADDED UP, NEVER STORED. It is the sum of an item's movements,
 * as cash on hand is in the books: a stored count could disagree with its
 * history, and then nobody could say which one was right. The server sums in
 * the database; this is the same rule for the rows a test or a view holds.
 */
export function onHand(moves: readonly Pick<StockDelta, 'quantity'>[]): StockQuantity {
  let total = 0;
  for (const move of moves) total += move.quantity;
  return total;
}

/** On hand per stock item, from any mix of items' movements. An item with no movements is absent, not zero. */
export function onHandByItem(moves: readonly StockDelta[]): ReadonlyMap<string, StockQuantity> {
  const totals = new Map<string, StockQuantity>();
  for (const move of moves) totals.set(move.stockItemId, (totals.get(move.stockItemId) ?? 0) + move.quantity);
  return totals;
}

/**
 * How an item stands. `lowStockAt` null means "no alert": it is never `low`,
 * only `out` at zero.
 *
 * `negative` is its own level rather than `out`, because the two call for
 * different acts: out means buy more, negative means the count is wrong and a
 * stock take is due (I5: never refused, always shown).
 */
export function stockLevel(quantity: StockQuantity, lowStockAt: StockQuantity | null): StockLevel {
  if (quantity < 0) return 'negative';
  if (quantity === 0) return 'out';
  if (lowStockAt !== null && quantity <= lowStockAt) return 'low';
  return 'ok';
}

/** Why a low-stock level is refused, or null. Null is "no alert"; zero would mean "alert only when out", which `out` already says. */
export function checkLowStockAt(value: StockQuantity | null): StockRefusal | null {
  if (value === null) return null;
  if (!isStockQuantity(value) || value <= 0) return 'invalid_low_stock';
  return null;
}
