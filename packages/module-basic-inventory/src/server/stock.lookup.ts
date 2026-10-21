import type { InScope, StockItemRow, StockTransaction } from './stock.repository.js';

/**
 * Reads several services share, written once (principle 5).
 */

/** A unique violation, detected structurally: this package has no `@prisma/client` to `instanceof` against. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/**
 * On hand per stock item, summed in the database. An item with no movements is
 * absent from the map, which every reader treats as zero.
 *
 * `ids` narrows it; omitted, every item of the workspace.
 */
export async function readOnHand(
  tx: Pick<StockTransaction, 'stockMove'>,
  scope: InScope,
  ids?: readonly string[],
): Promise<Map<string, number>> {
  if (ids && ids.length === 0) return new Map();
  const groups = await tx.stockMove.groupBy({
    by: ['stockItemId'],
    where: ids ? { ...scope, stockItemId: { in: [...ids] } } : { ...scope },
    _sum: { quantity: true },
  });
  return new Map(groups.map((group) => [group.stockItemId, Number(group._sum.quantity ?? 0)]));
}

/** One stock item, IN SCOPE, or null. */
export async function findItem(
  tx: Pick<StockTransaction, 'stockItem'>,
  scope: InScope,
  id: string,
): Promise<StockItemRow | null> {
  return tx.stockItem.findFirst({ where: { ...scope, id } });
}

/** The most items any one read loads: the cap's default. A store past it is a store the plan already stops growing. */
export const STOCK_READ_MAX = 1000;
