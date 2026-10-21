import type { PosItemView, PosStockLevelsView } from '../pos-client.js';

/**
 * What the till shows of the stock app's counts (INVENTORY-PLAN §6): "3 left",
 * "Out of stock", and a warning when a sale goes past zero.
 *
 * ⚠ A WARNING, NEVER A REFUSAL (I5). A count that is wrong must not stop a sale:
 * the till says so and sells, and the stock app shows the shelf as negative
 * until somebody counts it.
 */

/** How many are left per item or variant. Absent: the store does not count it. */
export type PosStockMap = ReadonlyMap<string, number>;

/** One key per sellable thing: the variant's, or the item's own when it has none. */
export function stockKey(itemId: string, variantId: string | null): string {
  return variantId ? `${itemId}:${variantId}` : itemId;
}

/** The answer as a map. Lines the store does not count (`left: null`) are left out, so they show nothing. */
export function stockMap(view: PosStockLevelsView | null): PosStockMap | null {
  if (!view?.counts) return null;
  const map = new Map<string, number>();
  for (const level of view.levels) {
    if (level.left !== null) map.set(stockKey(level.itemId, level.variantId), level.left);
  }
  return map;
}

/** How many of this are left, or null when not counted. */
export function leftOf(stock: PosStockMap | null, itemId: string, variantId: string | null): number | null {
  return stock?.get(stockKey(itemId, variantId)) ?? null;
}

/** The badge beside an item: "3 left" (warning when low), "Out of stock", or nothing. */
export function stockBadge(left: number | null): { text: string; tone: 'muted' | 'warning' | 'danger' } | null {
  if (left === null) return null;
  if (left <= 0) return { text: 'Out of stock', tone: 'danger' };
  return { text: `${left} left`, tone: left <= 3 ? 'warning' : 'muted' };
}

/**
 * The badge on an item's tile. An item with variants shows one only when
 * EVERY counted variant is out — otherwise the picker says which.
 */
export function tileLeft(stock: PosStockMap | null, item: Pick<PosItemView, 'id' | 'variants'>): number | null {
  const variants = item.variants.filter((variant) => variant.archivedAt === null);
  if (variants.length === 0) return leftOf(stock, item.id, null);
  const counted = variants.map((variant) => leftOf(stock, item.id, variant.id)).filter((left) => left !== null);
  if (counted.length === 0) return null;
  return counted.every((left) => left <= 0) ? 0 : null;
}

/**
 * What the till says after adding a line that goes past what is left, or null.
 * `inCart` is the quantity of that item or variant on the order now.
 */
export function stockWarning(name: string, left: number | null, inCart: number): string | null {
  if (left === null || inCart <= left) return null;
  if (left <= 0) {
    return `${name} shows as out of stock. The sale goes through — check the shelf, and tell whoever counts stock.`;
  }
  return `Only ${left} ${name} left in stock, and this order has ${inCart}. The sale goes through — check the shelf.`;
}
