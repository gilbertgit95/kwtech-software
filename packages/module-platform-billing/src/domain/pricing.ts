import { addDays, type DayKey, daysBetween } from './days.js';
import type { Centavos } from './money.js';
import type { Period } from './periods.js';
import { isMonths, isUpgrade, type Quote, quoteMonth, quotePlanChange, quoteRenewal, withPaidAhead } from './quotes.js';
import type { PlatformBillingRefusal } from './refusals.js';
import type { PricedKind } from './requests.js';
import { type BillingStanding, type PriceRow, priceOn } from './standing.js';

/**
 * WHAT A REQUEST COSTS ON A DAY, FROM THE ORGANIZATION'S STANDING
 * (PLATFORM-BILLING-PLAN §4, D10, D11, D12). One function for the preview the
 * owner sees, the bill issued at submission and the downgrade's bill issued at
 * approval, so the three cannot be priced three ways.
 */

/** A priced request: the quote, and the facts the bill and the approval keep. */
export interface PricedRequest {
  quote: Quote;
  /** Upgrade or downgrade, for a plan change; null otherwise. */
  direction: 'upgrade' | 'downgrade' | null;
  /**
   * A downgrade's bill is issued at approval, with the credit of that day (D12):
   * until then the quote is an estimate and no number is taken.
   */
  billAtSubmission: boolean;
  /**
   * For a plan change and a renewal: the period the price is for. A change is
   * refused at approval once this period has ended (`quote_expired`), and an
   * upgrade's approval-lag credit is worked out over it (D12).
   */
  period: Period | null;
  /** The monthly prices used, for the bill's lines. */
  monthly: Centavos;
  oldMonthly: Centavos | null;
}

/** The inputs of `priceRequest`. */
export interface PriceRequestInput {
  kind: PricedKind;
  /** The plan asked for (the current one, for a renewal). */
  planKey: string;
  currentPlanKey: string | null;
  standing: BillingStanding;
  prices: readonly PriceRow[];
  creditBalance: Centavos;
  day: DayKey;
  /**
   * What the paid-ahead month cost, when the row holds one (D11): the `month`
   * line of the renewal that paid it. Null prices it at today's rate.
   */
  prepaidMonthPaid?: Centavos | null;
  /**
   * Months paid for at once (#129), 1 when absent. Only a subscribe, a
   * replacement and a renewal buy whole months; a plan change runs to the end
   * of the current period and is refused with more.
   */
  months?: number;
}

/** The request priced on `input.day`, or the refusal when a plan it needs has no price. */
export function priceRequest(input: PriceRequestInput): PricedRequest | { refused: PlatformBillingRefusal } {
  const months = input.months ?? 1;
  if (!isMonths(months)) return { refused: 'invalid' };
  if (months > 1 && input.kind === 'change_plan') return { refused: 'invalid' };
  const monthly = priceOn(input.prices, input.planKey, input.day);
  if (monthly === null) return { refused: 'price_not_set' };

  switch (input.kind) {
    case 'subscribe':
    case 'replace':
      return {
        quote: withPaidAhead(quoteMonth(monthly, input.creditBalance), monthly, months),
        direction: null,
        billAtSubmission: true,
        period: null,
        monthly,
        oldMonthly: null,
      };
    case 'renew': {
      const window = input.standing.window;
      const period = input.standing.rowPeriod;
      if (!window || !period) return { refused: 'no_subscription' };
      // Access has ended: the bill charges what was used past the period end (D10).
      const late = input.day >= window.accessUntil;
      const accessUsed = late
        ? { days: daysBetween(window.periodEnd, window.accessUntil), oldMonthly: monthly, oldPeriod: period }
        : undefined;
      return {
        quote: withPaidAhead(quoteRenewal(monthly, input.creditBalance, accessUsed), monthly, months),
        direction: null,
        billAtSubmission: true,
        period,
        monthly,
        oldMonthly: monthly,
      };
    }
    case 'change_plan': {
      const period: Period | null = input.standing.currentPeriod;
      if (!period || !input.currentPlanKey) return { refused: 'no_subscription' };
      const oldMonthly = priceOn(input.prices, input.currentPlanKey, period.start);
      if (oldMonthly === null) return { refused: 'price_not_set' };
      const prepaidMonth = input.standing.prepaid ? (input.prepaidMonthPaid ?? oldMonthly) : 0;
      const upgrade = isUpgrade(oldMonthly, monthly);
      return {
        quote: quotePlanChange({
          oldMonthly,
          newMonthly: monthly,
          period,
          day: input.day,
          creditBalance: input.creditBalance,
          prepaidMonth,
        }),
        direction: upgrade ? 'upgrade' : 'downgrade',
        billAtSubmission: upgrade,
        period,
        monthly,
        oldMonthly,
      };
    }
  }
}

/** Whether a priced value is a refusal. */
export function isRefused<T extends object>(
  value: T | { refused: PlatformBillingRefusal },
): value is {
  refused: PlatformBillingRefusal;
} {
  return 'refused' in value;
}

/** Whether a bill's lines already charge for access used past the period end (D10). */
export function chargesAccessUsed(quote: Pick<Quote, 'lines'>): boolean {
  return quote.lines.some((line) => line.kind === 'access_used');
}

/** The day grace ends for a window: the last day a hold may still be earned by covering details (D9). */
export function graceEndOf(periodEnd: DayKey, graceDays: number): DayKey {
  return addDays(periodEnd, graceDays);
}
