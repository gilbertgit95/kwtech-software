import { computeOrderTotals } from '../domain/money.js';
import type { PosDiscount } from '../types.js';
import { refusalError } from './pos.errors.js';
import type { InScope, PosOrderLineRow, PosOrderRow, PosOrderUpdate, PosTransaction } from './pos.repository.js';

/**
 * Finding and saving an order the way EVERY service must: by id AND scope, and
 * every change a compare-and-set on its version.
 *
 * In one file so there is one way to do it. A service that looked an order up
 * by id alone would read another store's; one that wrote without the version
 * would let two tills both take payment for one order.
 */

type Reader = Pick<PosTransaction, 'posOrder' | 'posOrderLine'>;

/** An order in this store, or `not_found`. */
export async function loadOrder(client: Reader, scope: InScope, orderId: string): Promise<PosOrderRow> {
  const order = await client.posOrder.findFirst({ where: { ...scope, id: orderId } });
  if (!order) throw refusalError('not_found');
  return order;
}

/** An order's lines, in receipt order. */
export async function linesOf(client: Reader, orderId: string): Promise<PosOrderLineRow[]> {
  return client.posOrderLine.findMany({ where: { orderId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
}

/**
 * Writes `data` onto the order IF it is still at `order.version` (and still in
 * `order.status`), bumping the version. Zero rows means somebody changed it in
 * between: `conflict`, and the caller's transaction rolls back.
 */
export async function saveOrder(
  tx: Pick<PosTransaction, 'posOrder'>,
  scope: InScope,
  order: Pick<PosOrderRow, 'id' | 'version' | 'status'>,
  data: Omit<PosOrderUpdate, 'version'>,
): Promise<void> {
  const updated = await tx.posOrder.updateMany({
    where: { ...scope, id: order.id, version: order.version, status: order.status },
    data: { ...data, version: { increment: 1 } },
  });
  if (updated.count === 0) throw refusalError('conflict');
}

/** A discount as stored on a row, or null. */
export function storedDiscount(row: {
  discountKind: PosDiscount['kind'] | null;
  discountValue: number | null;
}): PosDiscount | null {
  if (!row.discountKind || row.discountValue === null) return null;
  return { kind: row.discountKind, value: row.discountValue };
}

/**
 * Adds the order up again from its lines (`computeOrderTotals`, the ONE place
 * that does) and stores every figure: each line's gross, discount, total and
 * net, and the order's. Called after every change to lines or discounts, in
 * the same transaction — so a stored total is never one step behind its lines.
 */
export async function recomputeTotals(
  tx: Pick<PosTransaction, 'posOrderLine'>,
  order: Pick<PosOrderRow, 'id' | 'discountKind' | 'discountValue'>,
  lines: readonly PosOrderLineRow[],
): Promise<Pick<PosOrderRow, 'gross' | 'lineDiscounts' | 'subtotal' | 'orderDiscount' | 'total'>> {
  const totals = computeOrderTotals(
    lines.map((line) => ({ unitPrice: line.unitPrice, quantity: line.quantity, discount: storedDiscount(line) })),
    storedDiscount(order),
  );
  // One line at a time: they are few, and each is its own conditional write.
  for (const [index, line] of lines.entries()) {
    const figures = totals.lines[index];
    if (!figures) continue;
    if (
      line.gross === figures.gross &&
      line.discountAmount === figures.discount &&
      line.total === figures.total &&
      line.net === figures.net
    ) {
      continue;
    }
    await tx.posOrderLine.updateMany({
      where: { id: line.id, orderId: order.id },
      data: { gross: figures.gross, discountAmount: figures.discount, total: figures.total, net: figures.net },
    });
  }
  return {
    gross: totals.gross,
    lineDiscounts: totals.lineDiscounts,
    subtotal: totals.subtotal,
    orderDiscount: totals.orderDiscount,
    total: totals.total,
  };
}
