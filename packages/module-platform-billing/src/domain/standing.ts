import { type AccessWindow, accessWindow, canRequestRenewal, type SubscriptionStanding, standingOn } from './access.js';
import { addDays, addMonthsAnchored, type DayKey, dayOfMonth, daysBetween } from './days.js';
import type { Centavos } from './money.js';
import type { Period } from './periods.js';
import type { RequestStanding } from './requests.js';

/**
 * WHERE AN ORGANIZATION STANDS, AS BILLING READS IT FROM ITS SUBSCRIPTION ROW
 * (PLATFORM-BILLING-PLAN §4). The row lives in `module-permissions`; the app
 * hands it over as days, and everything a request, a quote or a page needs is
 * derived here, once, so the server and the Billing page cannot disagree about
 * whether a renewal is open or a month was paid ahead.
 */

/** The live organization-wide subscription, as days in the platform's time zone. */
export interface SubscriptionDays {
  planKey: string;
  /** The plan is archived: it gives no access, and is replaced rather than renewed. */
  planArchived: boolean;
  /** Null on a row written before billing (#92); derived from the end and the billing day. */
  periodStart: DayKey | null;
  /** Null for a row with no end (the default subscription to Free, an admin's "no end"). */
  periodEnd: DayKey | null;
  billingDay: number | null;
  /** Null: no end. */
  accessUntil: DayKey | null;
  /** A trial (D2): free days, so nothing to renew, change or credit. */
  trial?: boolean;
}

/** What billing knows about the organization's subscription today. */
export interface BillingStanding {
  /** A live row with a period end on a plan that has a price, not a trial: there is something to renew or change. */
  hasPaidSubscription: boolean;
  /** The period the row stores: the CURRENT one, or one paid ahead. */
  rowPeriod: Period | null;
  /**
   * The period today falls in. Differs from `rowPeriod` only after an early
   * renewal, when the row already holds next month: then `prepaid` is true and
   * a plan change credits that month back (D11).
   */
  currentPeriod: Period | null;
  prepaid: boolean;
  window: AccessWindow | null;
  standing: SubscriptionStanding | null;
}

/** The period stored on a row, deriving a missing start from the end and the billing day. */
export function rowPeriodOf(row: Pick<SubscriptionDays, 'periodStart' | 'periodEnd' | 'billingDay'>): Period | null {
  if (!row.periodEnd) return null;
  const billingDay = row.billingDay ?? dayOfMonth(row.periodStart ?? row.periodEnd);
  const start = row.periodStart ?? addMonthsAnchored(row.periodEnd, -1, billingDay);
  return { start, end: row.periodEnd, billingDay };
}

/**
 * The access window the row's `accessUntil` stands for: the period end, the
 * grace in force, and whatever is left over as hold. A row whose access ends
 * before end + grace (a lower grace, an admin's date) reads as no hold, with the
 * grace it actually had.
 */
export function windowOf(periodEnd: DayKey, accessUntil: DayKey, graceDays: number): AccessWindow {
  const total = Math.max(0, daysBetween(periodEnd, accessUntil));
  const grace = Math.min(graceDays, total);
  return { ...accessWindow(periodEnd, grace, total - grace), accessUntil };
}

/** Billing's view of `row` on `today`. `isPaidPlan` says whether the plan has a price. */
export function billingStanding(
  row: SubscriptionDays | null,
  today: DayKey,
  graceDays: number,
  isPaidPlan: boolean,
): BillingStanding {
  const rowPeriod = row ? rowPeriodOf(row) : null;
  // ⚠ A trial is on a priced plan but was never paid: it reads as no paid subscription (D2).
  if (!row || !rowPeriod || !isPaidPlan || row.trial === true) {
    return { hasPaidSubscription: false, rowPeriod, currentPeriod: null, prepaid: false, window: null, standing: null };
  }
  const accessUntil = row.accessUntil ?? addDays(rowPeriod.end, graceDays);
  const window = windowOf(rowPeriod.end, accessUntil, graceDays);
  const prepaid = today < rowPeriod.start;
  const currentPeriod = prepaid
    ? {
        start: addMonthsAnchored(rowPeriod.start, -1, rowPeriod.billingDay),
        end: rowPeriod.start,
        billingDay: rowPeriod.billingDay,
      }
    : rowPeriod;
  return {
    hasPaidSubscription: true,
    rowPeriod,
    currentPeriod,
    prepaid,
    window,
    standing: standingOn(window, today),
  };
}

/** The request rules' view of the standing (`checkNewRequest`). */
export function requestStanding(
  billing: BillingStanding,
  row: Pick<SubscriptionDays, 'planArchived'> | null,
  today: DayKey,
  hasPendingRequest: boolean,
  cancelled: boolean,
): RequestStanding {
  const kind = billing.standing?.kind;
  return {
    hasPaidSubscription: billing.hasPaidSubscription,
    overdueOrExpired: kind === 'overdue' || kind === 'held' || kind === 'expired',
    currentPlanArchived: row?.planArchived ?? false,
    renewalOpen: billing.window ? canRequestRenewal(billing.window, today) : false,
    hasPendingRequest,
    cancelled,
  };
}

/** A plan's price from a day on. */
export interface PriceRow {
  planKey: string;
  monthly: Centavos;
  effectiveFrom: DayKey;
}

/** The monthly price of `planKey` on `day`: the latest row from that day or before, or null when none is set. */
export function priceOn(prices: readonly PriceRow[], planKey: string, day: DayKey): Centavos | null {
  let best: PriceRow | null = null;
  for (const price of prices) {
    if (price.planKey !== planKey || price.effectiveFrom > day) continue;
    if (!best || price.effectiveFrom > best.effectiveFrom) best = price;
  }
  return best ? best.monthly : null;
}

/** Whether `planKey` has any price at all: a plan with none (Free) is not one anybody pays for. */
export function hasAnyPrice(prices: readonly PriceRow[], planKey: string): boolean {
  return prices.some((price) => price.planKey === planKey && price.monthly > 0);
}

/** "B-000012", "R-000003": a document's number as printed. */
export function documentNumber(kind: 'bill' | 'receipt', value: number): string {
  return `${kind === 'bill' ? 'B' : 'R'}-${String(value).padStart(6, '0')}`;
}
