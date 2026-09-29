import type { PosOrderStatus, PosPaymentMethod, PosRefusal } from '../types.js';

/**
 * An order's life and its payment (POS-PLAN §3, D8, D12–D14, D17, guard rules).
 */

/**
 * ⚠ THE MESSAGE THE APP MATCHES ON. `formatError` strips `extensions` in
 * production, so a client never sees a refusal's reason — only its message.
 * The till reloads the order when it sees this one, so it is exported and
 * compared exactly.
 */
export const POS_CONFLICT_MESSAGE = 'Somebody else changed this order; it has been reloaded';

/** What can happen to an order. Each moves it from exactly one or two statuses. */
export type PosOrderAction = 'pay' | 'pay_later' | 'cancel' | 'void';

/**
 * The status an action moves an order to, or why it may not.
 *
 *   open   → pay → paid · pay_later → unpaid · cancel → cancelled
 *   unpaid → pay → paid · void → voided
 *
 * ⚠ NOTHING LEAVES paid, cancelled OR voided. A paid order is corrected by a
 * refund, a record of its own (D17); a cancelled or voided one is history.
 */
export function nextOrderStatus(
  status: PosOrderStatus,
  action: PosOrderAction,
): { status: PosOrderStatus } | { refused: PosRefusal } {
  switch (action) {
    case 'pay':
      if (status === 'open' || status === 'unpaid') return { status: 'paid' };
      return { refused: 'invalid_transition' };
    case 'pay_later':
      if (status === 'open') return { status: 'unpaid' };
      return { refused: 'not_open' };
    case 'cancel':
      if (status === 'open') return { status: 'cancelled' };
      return { refused: 'not_open' };
    case 'void':
      if (status === 'unpaid') return { status: 'voided' };
      return { refused: 'not_unpaid' };
  }
}

/** Whether an order's lines, customer, label and discounts may still change. Only while it is open (§3). */
export function isPosOrderEditable(status: PosOrderStatus): boolean {
  return status === 'open';
}

/**
 * Whether an order is FINALISED: numbered and locked. A number is taken in the
 * transaction that finalises (§3), so cancelled orders never have one and
 * voided ones keep theirs.
 */
export function isPosOrderFinalised(status: PosOrderStatus): boolean {
  return status === 'unpaid' || status === 'paid' || status === 'voided';
}

/**
 * Whether a change based on `expectedVersion` may land on an order now at
 * `currentVersion` (guard rules, "two people on one order").
 *
 * The service does not trust this alone: the write is conditional on the
 * version too (`where: { id, version }`), so two saves that both pass this
 * check cannot both land.
 */
export function checkOrderVersion(expectedVersion: number, currentVersion: number): PosRefusal | null {
  return expectedVersion === currentVersion ? null : 'conflict';
}

/**
 * Cancelling needs a reason once the order has lines (guard rules). An empty
 * cart dropped is nothing; a ₱500 cart dropped instead of paid is where cash
 * goes missing, so it must be explained and it stays on the record.
 */
export function cancelNeedsReason(lineCount: number): boolean {
  return lineCount > 0;
}

/** Who the order is for, as the payment checks need it. */
export interface PosCustomerFacts {
  name: string | null;
  contact: string | null;
}

/**
 * Whether an order may be released UNPAID (D13): the customer takes the items
 * and pays another day, so the store must know who they are and how to reach
 * them. A recorded customer or typed details both do.
 */
export function checkPayLater(customer: PosCustomerFacts, lineCount: number): PosRefusal | null {
  if (lineCount === 0) return 'invalid_transition';
  if (!customer.name || !customer.contact) return 'customer_required';
  return null;
}

/** A payment as the till sends it. */
export interface PosPaymentInput {
  method: PosPaymentMethod;
  /** What the customer handed over (cash) or sent (e-wallet, card), in centavos. */
  received: number;
  /** What they left as a tip (D12). */
  tip: number;
  /** Change the store could not give yet (D14). Cash only. */
  changeOwed: number;
}

/**
 * Checks a payment of an order totalling `total`, and works out the change
 * handed back now (D12, D14, guard rules "payment checks"):
 *
 *   received = total + change given + change owed + tip
 *
 * - Cash: received ≥ total; what is over is change, some of it perhaps kept
 *   as a tip or owed.
 * - E-wallet and card: received = total + tip exactly. There is no change on
 *   a transfer, so nothing may be "given back" or "owed".
 * - Change owed needs the customer's name and contact: the store must find
 *   them to pay it.
 * - An order discounted to ₱0 completes with ₱0 received.
 */
export function planPayment(
  total: number,
  payment: PosPaymentInput,
  customer: PosCustomerFacts,
): { change: number } | { refused: PosRefusal } {
  const amounts = [payment.received, payment.tip, payment.changeOwed];
  if (!amounts.every((value) => Number.isSafeInteger(value) && value >= 0)) return { refused: 'invalid_amount' };
  if (payment.received < total) return { refused: 'insufficient_payment' };
  const change = payment.received - total - payment.tip - payment.changeOwed;
  if (change < 0) return { refused: 'invalid_amount' };
  if (payment.method !== 'cash' && (change > 0 || payment.changeOwed > 0)) return { refused: 'change_not_allowed' };
  if (payment.changeOwed > 0 && (!customer.name || !customer.contact)) return { refused: 'customer_required' };
  return { change };
}

/** How owed change was settled later (D14): handed over, or the customer said keep it. */
export type PosChangeSettlement = 'given' | 'tip';
