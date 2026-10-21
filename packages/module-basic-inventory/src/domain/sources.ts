/**
 * The keys that make another module's event take stock ONCE (INVENTORY-PLAN §3,
 * §5).
 *
 * ⚠ ONE KEY PER EVENT, UNIQUE PER STOCK ITEM. A movement from another module
 * carries the event's key under `@@unique([workspaceId, sourceKey,
 * stockItemId])`: the push after the POS's commit and the catch-up process can
 * both deliver the same line, in any order, any number of times, and only the
 * first writes. The key is built here and nowhere else, so the two paths cannot
 * spell it differently.
 */

/** A POS order line finalised: paid, or released unpaid with pay later (I4). */
export function posLineKey(orderLineId: string): string {
  return `pos:line:${orderLineId}`;
}

/** That line's goods back after its unpaid order was voided. One void per line, ever. */
export function posVoidKey(orderLineId: string): string {
  return `pos:void:${orderLineId}`;
}

/** A refund line whose units were put back on the shelf. One per refund line, ever. */
export function posRefundKey(refundLineId: string): string {
  return `pos:refund:${refundLineId}`;
}

/**
 * The order line a POS key is about, or null for a key that is not a POS
 * line's (`pos:refund:` keys name the REFUND line, and carry the order line
 * separately).
 */
export function orderLineOfKey(sourceKey: string): string | null {
  const match = /^pos:(?:line|void):(.+)$/u.exec(sourceKey);
  return match?.[1] ?? null;
}
