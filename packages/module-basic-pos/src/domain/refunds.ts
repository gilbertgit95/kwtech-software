import type { PosOrderStatus, PosRefusal } from '../types.js';
import { checkPosQuantity } from './money.js';

/**
 * Refunds (D17): a record of its own against a PAID order, which never
 * changes. By line (which line, how many) or by amount (money back, nothing
 * returned). Never more than was paid.
 */

/** One sold line as a refund needs it. `net` is what the customer actually paid for it (`PosLineTotals.net`). */
export interface PosRefundableLine {
  id: string;
  quantity: number;
  net: number;
}

/** What has been refunded before, across every earlier refund of the order. */
export interface PosRefundedSoFar {
  /** Units refunded per line id. */
  quantities: Readonly<Record<string, number>>;
  /** Centavos refunded in all, by line and by amount. */
  amount: number;
}

export type PosRefundRequest =
  | { kind: 'lines'; lines: readonly { lineId: string; quantity: number }[] }
  | { kind: 'amount'; amount: number };

/** A refund as it will be stored. */
export interface PosRefundPlan {
  amount: number;
  lines: readonly { lineId: string; quantity: number; amount: number }[];
}

/**
 * What giving back `quantity` more units of a line is worth, when `before`
 * units were given back already.
 *
 * ⚠ CUMULATIVE, so the parts add up to the line EXACTLY. Each refund is
 * `floor(net × after ÷ sold) − floor(net × before ÷ sold)`: three magnets that
 * cost ₱100 together come back as ₱33, ₱33 and ₱34, and all three together are
 * ₱100 — never ₱99 from rounding each unit on its own.
 */
export function refundLineAmount(line: PosRefundableLine, before: number, quantity: number): number {
  const valueAt = (units: number) => Number((BigInt(line.net) * BigInt(units)) / BigInt(line.quantity));
  return valueAt(before + quantity) - valueAt(before);
}

/**
 * Plans a refund of an order, or says why not.
 *
 * ⚠ TWO CAPS, BOTH CHECKED: per line, never more units than were sold minus
 * those already refunded; per order, never more money than was paid (`total`)
 * minus what was already refunded — a refund by amount and a refund by line
 * draw on the same money. A tip is not refundable: it was not the sale.
 */
export function planRefund(
  order: { status: PosOrderStatus; total: number; lines: readonly PosRefundableLine[] },
  soFar: PosRefundedSoFar,
  request: PosRefundRequest,
): PosRefundPlan | { refused: PosRefusal } {
  if (order.status !== 'paid') return { refused: 'not_paid' };
  const left = order.total - soFar.amount;
  if (request.kind === 'amount') {
    if (!Number.isSafeInteger(request.amount) || request.amount <= 0) return { refused: 'invalid_amount' };
    if (request.amount > left) return { refused: 'exceeds_paid' };
    return { amount: request.amount, lines: [] };
  }

  if (request.lines.length === 0) return { refused: 'invalid_quantity' };
  const seen = new Set<string>();
  const planned: { lineId: string; quantity: number; amount: number }[] = [];
  for (const wanted of request.lines) {
    const line = order.lines.find((candidate) => candidate.id === wanted.lineId);
    if (!line || seen.has(wanted.lineId)) return { refused: 'unknown_line' };
    seen.add(wanted.lineId);
    if (checkPosQuantity(wanted.quantity)) return { refused: 'invalid_quantity' };
    const before = soFar.quantities[line.id] ?? 0;
    if (before + wanted.quantity > line.quantity) return { refused: 'exceeds_sold' };
    planned.push({
      lineId: line.id,
      quantity: wanted.quantity,
      amount: refundLineAmount(line, before, wanted.quantity),
    });
  }
  const amount = planned.reduce((total, line) => total + line.amount, 0);
  if (amount > left) return { refused: 'exceeds_paid' };
  return { amount, lines: planned };
}

/** How refunded an order is, derived from its refunds — never stored as a status (D17). */
export function refundState(total: number, refunded: number): 'none' | 'partly' | 'full' {
  if (refunded <= 0) return 'none';
  return refunded >= total ? 'full' : 'partly';
}
