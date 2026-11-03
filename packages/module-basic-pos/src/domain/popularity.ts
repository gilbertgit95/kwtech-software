import { shiftDayKey } from './reports.js';

/**
 * "Most ordered first" on the sell views (issue #47): the items and sizes a
 * store sells most sit at the top of their category, so they take the fewest
 * taps to reach.
 *
 * ⚠ A DAILY SNAPSHOT, NOT A LIVE COUNT. A background process (`pos.rank_items`)
 * counts the last `POS_POPULARITY_DAYS` complete days once a day and stores
 * the result; the till reads that and never counts order lines itself. Today's
 * sales count from tomorrow — an order of which items sell most does not need
 * to be up to the minute, and a ranking that moves only once a day never
 * shuffles tiles under a cashier's finger (the operator, 2026-11-03).
 *
 * The alternative — per-day counters bumped in the finalise transaction and
 * taken back on a void — was the issue's first design. It put a write in every
 * payment for a number nobody needs before tomorrow.
 */

/** How many complete days the ranking looks back over: the 7 days before the day it is made. */
export const POS_POPULARITY_DAYS = 7;

/**
 * The days a ranking made on `today` counts, both ends included: the
 * `POS_POPULARITY_DAYS` days before `today`, never `today` itself — a day
 * half sold would rank the morning's items over the evening's.
 */
export function popularityWindow(today: string): { fromDay: string; toDay: string } {
  return { fromDay: shiftDayKey(today, -POS_POPULARITY_DAYS), toDay: shiftDayKey(today, -1) };
}

/** One order line, as the count reads it. */
export interface PosPopularityLine {
  orderId: string;
  itemId: string;
  variantId: string | null;
}

/** How many orders included an item, or one of its variants. */
export interface PosOrderCount {
  id: string;
  orders: number;
}

export interface PosVariantOrderCount extends PosOrderCount {
  itemId: string;
}

/**
 * How many ORDERS included each item and each variant — not how many units.
 *
 * ⚠ ONCE PER ORDER. An order with the same item on three lines, or a quantity
 * of 50, counts once for it: a café's one big catering order must not outrank
 * the coffee a hundred people bought. A variant counts once per order it is
 * on, and its item once whichever of its sizes the order had.
 *
 * Both lists most ordered first, then by id, so the same lines give the same
 * answer.
 */
export function countPosOrders(lines: readonly PosPopularityLine[]): {
  items: PosOrderCount[];
  variants: PosVariantOrderCount[];
} {
  const itemOrders = new Map<string, Set<string>>();
  const variantOrders = new Map<string, { itemId: string; orders: Set<string> }>();
  for (const line of lines) {
    const forItem = itemOrders.get(line.itemId) ?? new Set<string>();
    forItem.add(line.orderId);
    itemOrders.set(line.itemId, forItem);
    if (line.variantId === null) continue;
    const forVariant = variantOrders.get(line.variantId) ?? { itemId: line.itemId, orders: new Set<string>() };
    forVariant.orders.add(line.orderId);
    variantOrders.set(line.variantId, forVariant);
  }
  const items = [...itemOrders].map(([id, orders]) => ({ id, orders: orders.size }));
  const variants = [...variantOrders].map(([id, entry]) => ({ id, itemId: entry.itemId, orders: entry.orders.size }));
  return { items: items.sort(mostOrderedFirst), variants: variants.sort(mostOrderedFirst) };
}

function mostOrderedFirst(a: PosOrderCount, b: PosOrderCount): number {
  return b.orders - a.orders || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Counts → a rank each: 1 is the most ordered, and a tie shares its rank
 * ("1, 2, 2, 4"), so two items sold equally keep the store's own order between
 * them rather than one the counting happened to pick.
 *
 * ⚠ What a till is sent: the rank, never the count. How much a store sells of
 * what is the reports' business (`pos:reports`), and every till may read this.
 */
export function rankPosOrders(counts: readonly PosOrderCount[]): Map<string, number> {
  const sorted = [...counts].sort(mostOrderedFirst);
  const ranks = new Map<string, number>();
  let previous: { orders: number; rank: number } | null = null;
  for (const [index, entry] of sorted.entries()) {
    const rank: number = previous !== null && previous.orders === entry.orders ? previous.rank : index + 1;
    ranks.set(entry.id, rank);
    previous = { orders: entry.orders, rank };
  }
  return ranks;
}

/**
 * Rows by rank, best first; rows with no rank (not ordered in the window, or
 * added since the ranking was made) after every ranked one. ⚠ STABLE: ties and
 * the unranked keep the order they came in — the name for items, the store's
 * `sortOrder` for variants — so a new store, with no ranking yet, sees exactly
 * what it saw before #47.
 *
 * Availability is applied ON TOP (`availableFirst`): a sold-out best seller
 * still goes after everything that can be sold (#37).
 */
export function byPopularity<T>(rows: readonly T[], rankOf: (row: T) => number | null): T[] {
  // `Array.prototype.sort` is stable (ES2019), which is what keeps ties in place.
  return [...rows].sort((a, b) => compareRanks(rankOf(a), rankOf(b)));
}

/** Two ranks compared, best first, the unranked last. For a sort that has keys of its own (search). */
export function compareRanks(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return a - b;
}
