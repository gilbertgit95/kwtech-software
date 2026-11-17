import type { PosOrderSummaryView } from '../pos-client.js';
import { heldOrderDetail, heldOrderTitle } from './take-orders.js';

/**
 * Telling a held order on the till from a new one (issue #162).
 *
 * A seller tapped a pending order by accident, then rang up the next
 * customer's items onto it, sure it was a new order: nothing on the till said
 * otherwise, and the only way off it was Hold, which read as "save". So every
 * sell view says so in a banner while a held order is on the till, with a
 * Close that takes it off and leaves it waiting, unchanged by the close.
 */

/**
 * The held order on the till, as the waiting list knows it, or null for a new
 * order, a finished one, or a clear till.
 *
 * ⚠ HELD MEANS LISTED IN PENDING (open, and Hold set it aside), the rule
 * `canLeaveOrder` and Take orders already go by. The order on the till does
 * not carry its `heldAt`, and an order never held is listed nowhere — so an
 * order being taken never shows the banner, and a held one always does.
 */
export function heldOrderOnTill(
  order: { id: string; status: string } | null,
  pending: readonly PosOrderSummaryView[],
): PosOrderSummaryView | null {
  if (order?.status !== 'open') return null;
  return pending.find((one) => one.id === order.id) ?? null;
}

/** What the banner says. */
export interface HeldOrderBannerText {
  /** "Held order: Table 4" — the name the waiting list gives it, so the two are plainly the same order. */
  heading: string;
  /** "Dine-in · 3 items" */
  detail: string;
  /**
   * ⚠ SAYS THAT CHANGES ARE ALREADY SAVED. Every act on the till is written to
   * the order as it happens (no cart in the browser), so Close cannot throw
   * them away — and must not look as if it could.
   */
  note: string;
}

export function heldOrderBanner(held: PosOrderSummaryView): HeldOrderBannerText {
  return {
    heading: `Held order: ${heldOrderTitle(held)}`,
    detail: heldOrderDetail(held),
    note: 'Changes here are saved to this order. Close it to start a new one; it keeps waiting for payment.',
  };
}

/** The Close button's accessible name: which order it closes, since a screen reader hears the button alone. */
export function closeHeldOrderLabel(held: PosOrderSummaryView): string {
  return `Close ${heldOrderTitle(held)} and start a new order`;
}

/** Said once Close has taken it off the till, so the seller knows where it went. */
export function closedHeldOrderNotice(held: PosOrderSummaryView): string {
  return `Closed ${heldOrderTitle(held)}. It is still waiting for payment.`;
}
