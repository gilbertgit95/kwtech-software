import type { PosOrderView } from '../pos-client.js';

/**
 * THE PHONE'S ORDERS (issue #72): the rules its screen draws that the full
 * screen has no need of, kept here so they are tested. The list, its filters,
 * its chips and its total are the full screen's own (`useOrderList`,
 * `view/manage.ts`): nothing restated for the phone.
 */

/**
 * What still has to happen to an order, and where, for a screen that only
 * looks (issue #72: the phone's Orders views and prints, it never changes an
 * order). Null when nothing is waiting on anybody.
 *
 * - `go`: `'cashier'` when the phone's own Cashier section can do it — a held
 *   order, for somebody who may take payment — so the sheet offers the way
 *   there. Otherwise the full screen's Orders tab does it, and the sentence
 *   says so: a button to a place this person cannot act would be a dead end.
 * - ⚠ Change owed counts only while unsettled (`changeSettlement` null): once
 *   given or kept as a tip, nobody owes anything.
 */
export function phoneOrderNextStep(
  order: Pick<PosOrderView, 'status' | 'changeOwed' | 'changeSettlement'>,
  can: { takePayment: boolean },
): { text: string; go: 'cashier' | null } | null {
  switch (order.status) {
    case 'open':
      return can.takePayment
        ? { text: 'Waiting for payment. Take it in Cashier.', go: 'cashier' }
        : { text: 'Waiting for payment at the cashier.', go: null };
    case 'unpaid':
      return { text: 'To be paid later. Take the payment on the full screen’s Orders tab.', go: null };
    case 'paid':
      if (order.changeOwed > 0 && order.changeSettlement === null) {
        return { text: 'Change is still owed to the customer. Settle it on the full screen’s Orders tab.', go: null };
      }
      return null;
    case 'cancelled':
    case 'voided':
      return null;
    default:
      // The wire's status is a string; one this screen does not know asks for nothing.
      return null;
  }
}
