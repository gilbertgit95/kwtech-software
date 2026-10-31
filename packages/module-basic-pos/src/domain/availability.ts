import type { PosRefusal } from '../types.js';

/**
 * "Not available" (issue #37): an item or one variant taken off sale for a
 * while — sold out for the day, an ingredient ran out, a machine is down —
 * WITHOUT archiving it. It keeps its place in the catalogue, its tile and its
 * room under `pos:items`; it only cannot be added to an order.
 *
 * ⚠ NOT THE STOCK APP'S "Out of stock". That is a warning that depends on the
 * stock being counted, and the sale still goes through. This is a switch a
 * person sets, the server refuses on, and only a person clears: there is no
 * daily reset and no background process.
 *
 * The rules here are read by the server (the refusal) and the till (greyed
 * out, sorted last), so the two never disagree.
 */

/** Anything with the switch: an item or a variant, as a row (a `Date`) or as the till reads it (a string). */
export interface PosAvailabilityFlag {
  unavailableAt: Date | string | null;
}

/** A variant as availability reads it: archived ones are not on sale either way, and do not count. */
export interface PosAvailabilityVariant extends PosAvailabilityFlag {
  archivedAt: Date | string | null;
}

export interface PosAvailabilityItem extends PosAvailabilityFlag {
  variants: readonly PosAvailabilityVariant[];
}

/**
 * How many items and variants one switch may name at once — the bulk "Mark
 * not available". The default `pos:items` cap, so a store on the default plan
 * switches its whole catalogue in one action, and one transaction.
 */
export const POS_AVAILABILITY_BATCH_MAX = 1000;

/**
 * Whether this variant of this item can be sold. ⚠ THE ITEM'S SWITCH WINS:
 * a variant left on under an item switched off is still not for sale, so
 * switching the item back on brings back exactly the sizes that were on.
 */
export function isPosVariantAvailable(item: PosAvailabilityFlag, variant: PosAvailabilityFlag): boolean {
  return item.unavailableAt === null && variant.unavailableAt === null;
}

/**
 * Whether an item has anything to sell: its own switch on, and — when it has
 * live variants — at least one of them on. An item whose every size is off
 * counts as not available, for the badge and for sorting.
 */
export function isPosItemAvailable(item: PosAvailabilityItem): boolean {
  if (item.unavailableAt !== null) return false;
  const live = item.variants.filter((variant) => variant.archivedAt === null);
  return live.length === 0 || live.some((variant) => variant.unavailableAt === null);
}

/**
 * The server's refusal for a line about to be added, or null. The variant is
 * the one being added (null: the item as it is).
 *
 * ⚠ ONLY ADDING IS REFUSED. Orders that already hold the item keep their lines
 * and can still be paid, refreshed, lowered or removed; what is refused is
 * selling MORE of it — a new line, or a line's quantity going up.
 */
export function checkPosAvailable(item: PosAvailabilityFlag, variant: PosAvailabilityFlag | null): PosRefusal | null {
  if (item.unavailableAt !== null) return 'item_unavailable';
  if (variant && variant.unavailableAt !== null) return 'item_unavailable';
  return null;
}

/**
 * The available ones first, then the rest — each half in the order it came
 * in, so the store's own order (or the name order) holds inside both. What
 * every sell view does to its items, its variants and its search results.
 */
export function availableFirst<T>(rows: readonly T[], isAvailable: (row: T) => boolean): T[] {
  const on: T[] = [];
  const off: T[] = [];
  for (const row of rows) (isAvailable(row) ? on : off).push(row);
  return [...on, ...off];
}

/**
 * What one switch names, deduplicated, or why it is refused: nothing named, or
 * more than `POS_AVAILABILITY_BATCH_MAX`. The ids are checked against the
 * store by the service, in the transaction.
 */
export function preparePosAvailabilityTargets(input: {
  itemIds: readonly string[];
  variantIds: readonly string[];
}): { itemIds: string[]; variantIds: string[] } | { refused: PosRefusal } {
  const itemIds = [...new Set(input.itemIds)];
  const variantIds = [...new Set(input.variantIds)];
  if (itemIds.length + variantIds.length === 0) return { refused: 'empty_selection' };
  if (itemIds.length + variantIds.length > POS_AVAILABILITY_BATCH_MAX) return { refused: 'limit_reached' };
  return { itemIds, variantIds };
}
