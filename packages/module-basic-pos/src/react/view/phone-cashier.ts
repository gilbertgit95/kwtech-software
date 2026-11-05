import type { PosOrderSummaryView, PosOrderView } from '../pos-client.js';
import { waitMinutes } from './take-orders.js';

/**
 * THE PHONE'S CASHIER (issue #69): the rules its screen draws, kept here so
 * they are tested. The list itself, its order and its colours are the full
 * screen Cashier's own (`state.pending`, oldest first; `waitUrgency`): one
 * set of rules for both screens, nothing restated for the phone.
 */

/** The head of the phone's list: how many wait, what they come to, and how long the oldest has waited. */
export interface PosWaitingSummary {
  count: number;
  /** Every waiting order's total, in centavos (as every amount here): what the cashier still has to collect. */
  total: number;
  /** Minutes the oldest has waited; null with nothing waiting, or before the clock is read (`useNow`). */
  oldestMinutes: number | null;
}

export function waitingSummary(
  pending: readonly Pick<PosOrderSummaryView, 'total' | 'createdAt'>[],
  now: Date | null,
): PosWaitingSummary {
  const total = pending.reduce((sum, order) => sum + order.total, 0);
  // Oldest first already (the server's order), but the earliest is taken, not assumed: a list re-read mid-tap is still right.
  let oldest: string | null = null;
  for (const order of pending) {
    if (oldest === null || order.createdAt < oldest) oldest = order.createdAt;
  }
  return {
    count: pending.length,
    total,
    oldestMinutes: oldest !== null && now ? waitMinutes(oldest, now) : null,
  };
}

/**
 * What the order sheet shows:
 *
 * - `order`: an open order, to check, change and pay.
 * - `receipt`: the order THIS phone just settled (paid, or released as Pay
 *   later), with its change, until "Done".
 * - `settled_elsewhere`: the order left the till's hands while the sheet was
 *   open — another till paid or cancelled it, and the live re-read brought
 *   that back. ⚠ Never shown as this phone's receipt: the cashier would hand
 *   over change for a payment somebody else took.
 * - `none`: nothing on the till.
 */
export type PosPhoneCashierSheet = 'order' | 'receipt' | 'settled_elsewhere' | 'none';

export function phoneCashierSheet(
  order: Pick<PosOrderView, 'id' | 'status'> | null,
  settledHereId: string | null,
): PosPhoneCashierSheet {
  if (!order) return 'none';
  if (order.status === 'open') return 'order';
  if (order.id === settledHereId) return 'receipt';
  return 'settled_elsewhere';
}

/** The words for an order another till settled, by its status. */
export function settledElsewhereText(status: string): string {
  if (status === 'paid') return 'This order was paid at another till.';
  if (status === 'unpaid') return 'This order was released as Pay later at another till.';
  if (status === 'cancelled') return 'This order was cancelled at another till.';
  return 'This order was settled at another till.';
}

/** Philippine bills, in centavos, smallest first: what a customer hands over for cash. */
const PESO_BILLS = [2_000, 5_000, 10_000, 20_000, 50_000, 100_000] as const;

/** How many round amounts the phone offers beside "Exact": a row a thumb can scan at once. */
const QUICK_CASH_COUNT = 3;

/**
 * The phone's quick cash buttons (issue #69): the exact total, then the next
 * few round amounts a customer is likely to hand over — the total rounded up
 * to each bill — so the cashier taps "₱500" rather than typing it with the
 * keyboard over the screen. Every amount is above the total, none repeats,
 * smallest first. In centavos.
 */
export function quickCashAmounts(total: number): readonly number[] {
  if (total <= 0) return [];
  const rounded = new Set<number>();
  for (const bill of PESO_BILLS) {
    const amount = Math.ceil(total / bill) * bill;
    if (amount > total) rounded.add(amount);
  }
  // Sorted after rounding, not by bill: ₱645 rounds to ₱660 by twenties but ₱650 by fifties.
  return [total, ...[...rounded].sort((a, b) => a - b).slice(0, QUICK_CASH_COUNT)];
}
