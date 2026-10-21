import type { StockDelta, StockQuantity, StockRefusal, StockUseLine, StockUseRefKind } from '../types.js';
import { STOCK_QUANTITY_SCALE } from './quantities.js';

/**
 * Materials lists: what one unit of something sold takes off stock
 * (INVENTORY-PLAN §2, I13, I14).
 *
 * A list sits on a POS ITEM (what every variant uses: the hook, the border)
 * and on a VARIANT (what changes with it: the A3 board, two vinyl sheets). A
 * sale of the variant uses both. A POS product sold as it is has a list of one
 * line: itself, at one per unit.
 */

/** What a sold line is, as the POS reports it: the item, the variant if any, and how many whole units. */
export interface StockSoldRef {
  itemId: string;
  variantId: string | null;
  /** Whole units, as an order line's quantity is. */
  quantity: number;
}

/** The largest per-unit quantity on a list: a thousand units per one sold, which no real product needs. */
export const STOCK_USE_PER_UNIT_MAX = 1000 * STOCK_QUANTITY_SCALE;

/**
 * The lines of a materials list that apply to one sold item or variant: the
 * item's own, plus the variant's when it has one.
 */
export function usesFor(
  uses: readonly StockUseLine[],
  ref: Pick<StockSoldRef, 'itemId' | 'variantId'>,
): StockUseLine[] {
  return uses.filter(
    (use) =>
      (use.refKind === 'item' && use.refId === ref.itemId) ||
      (use.refKind === 'variant' && ref.variantId !== null && use.refId === ref.variantId),
  );
}

/**
 * What a sold line takes off stock, per stock item, as NEGATIVE deltas, in a
 * stable order (by stock item id) so the server writes rows in the same order
 * every time and two concurrent intakes cannot deadlock on each other.
 *
 * A stock item on both the item's and the variant's list ADDS UP (I14): the
 * form warns when it is entered twice (`overlappingUses`), but a list saved
 * that way means what it says.
 *
 * Empty when nothing uses stock: the POS item is not tracked, and the sale
 * moves nothing.
 */
export function planLineTakes(uses: readonly StockUseLine[], sold: StockSoldRef): StockDelta[] {
  const totals = new Map<string, StockQuantity>();
  for (const use of usesFor(uses, sold)) {
    totals.set(use.stockItemId, (totals.get(use.stockItemId) ?? 0) + use.quantityPerUnit * sold.quantity);
  }
  return (
    [...totals.entries()]
      .filter(([, quantity]) => quantity !== 0)
      // Map keys are unique, so two ids are never equal here.
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([stockItemId, quantity]) => ({ stockItemId, quantity: -quantity }))
  );
}

/**
 * How many more of an item or variant the shelf can still make: the fewest
 * over its materials (12 blank mugs and 300 sheets make 12), never below zero.
 * Null when nothing on its lists is tracked, so the till shows no count at all
 * rather than "0 left" for something the store never counts.
 *
 * `onHand` is per stock item; one missing from it has nothing on hand.
 */
export function canStillMake(
  uses: readonly StockUseLine[],
  ref: Pick<StockSoldRef, 'itemId' | 'variantId'>,
  onHand: ReadonlyMap<string, StockQuantity>,
): number | null {
  const perUnit = planLineTakes(uses, { ...ref, quantity: 1 });
  if (perUnit.length === 0) return null;
  let fewest = Number.POSITIVE_INFINITY;
  for (const take of perUnit) {
    const needed = -take.quantity;
    const have = onHand.get(take.stockItemId) ?? 0;
    fewest = Math.min(fewest, have <= 0 ? 0 : Math.floor(have / needed));
  }
  return fewest;
}

/** One line of a list as a form sends it. */
export interface StockUseDraft {
  stockItemId: string;
  quantityPerUnit: StockQuantity;
}

/**
 * Why a list for one item or one variant is refused, or null: a quantity that
 * is not positive or is past the cap, or the same stock item twice on one
 * list (two lines for the hook would make "how much does this use" a sum
 * nobody typed).
 */
export function checkUseList(lines: readonly StockUseDraft[]): StockRefusal | null {
  const seen = new Set<string>();
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantityPerUnit) || line.quantityPerUnit <= 0) return 'invalid_quantity';
    if (line.quantityPerUnit > STOCK_USE_PER_UNIT_MAX) return 'invalid_quantity';
    if (seen.has(line.stockItemId)) return 'duplicate_use';
    seen.add(line.stockItemId);
  }
  return null;
}

/**
 * Stock items on BOTH an item's list and one of its variants' lists. Allowed
 * (they add up), but the form names them, because it is more often a slip than
 * a variant that really uses a second hook.
 */
export function overlappingUses(uses: readonly Pick<StockUseLine, 'refKind' | 'stockItemId'>[]): string[] {
  const onItem = new Set(uses.filter((use) => use.refKind === 'item').map((use) => use.stockItemId));
  const both = new Set<string>();
  for (const use of uses) if (use.refKind === 'variant' && onItem.has(use.stockItemId)) both.add(use.stockItemId);
  return [...both].sort();
}

/** The list a POS product sold as it is gets from "Create from POS products" (I17): itself, one per unit. */
export function oneToOneUse(refKind: StockUseRefKind, refId: string, stockItemId: string): StockUseLine {
  return { refKind, refId, stockItemId, quantityPerUnit: STOCK_QUANTITY_SCALE };
}
