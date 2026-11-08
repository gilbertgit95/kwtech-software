import type { DayKey } from './days.js';
import type { Centavos } from './money.js';
import { daysLeft } from './periods.js';
import { archiveCredit } from './quotes.js';
import { type BillingStanding, type PriceRow, priceOn } from './standing.js';

/**
 * WHAT ARCHIVING A PLAN OWES THE ORGANIZATIONS ON IT (PLATFORM-BILLING-PLAN
 * §4, D12b). Archiving cuts the plan's access at once, so the paid days from
 * the archive day to the period end are lost. They are credited when the plan
 * is archived, not when the organization later chooses a replacement, so a
 * replacement approved weeks later still finds them.
 */

/** The credit one organization is owed, with the facts its ledger line states. */
export interface ArchiveCredit {
  /** The whole credit: the current period's lost days plus a month paid ahead. */
  amount: Centavos;
  /** Paid days lost in the current period, counting the archive day itself. */
  days: number;
  /** A whole month renewed early and now unusable (D11's month paid ahead), or 0. */
  prepaidMonth: Centavos;
}

/**
 * The credit an organization standing at `standing` on `planKey` is owed when
 * the plan is archived on `today`, or null when it is owed nothing: no paid
 * subscription (Free, a trial), a period already over (overdue days were never
 * paid), or a plan with no price.
 *
 * The current period's days are priced as the period was (its start's price);
 * a month paid ahead is the price on that month's start, as a plan change
 * credits it (`priceRequest`).
 */
export function planArchiveCredit(
  standing: BillingStanding,
  prices: readonly PriceRow[],
  planKey: string,
  today: DayKey,
): ArchiveCredit | null {
  const period = standing.currentPeriod;
  if (!standing.hasPaidSubscription || !period) return null;
  const monthly = priceOn(prices, planKey, period.start);
  if (monthly === null) return null;
  const days = daysLeft(period, today);
  const current = days > 0 ? archiveCredit(monthly, period, today) : 0;
  const ahead = standing.prepaid && standing.rowPeriod ? priceOn(prices, planKey, standing.rowPeriod.start) : null;
  const prepaidMonth = ahead ?? 0;
  const amount = current + prepaidMonth;
  return amount > 0 ? { amount, days, prepaidMonth } : null;
}

/**
 * The sentence on the ledger line (plan §4): "Basic (2025) was withdrawn on
 * 2026-11-08; 18 paid days added as credit". Stored with the entry, so the
 * history reads the same after the plan is renamed.
 */
export function archiveCreditNote(planLabel: string, today: DayKey, credit: ArchiveCredit): string {
  const days = credit.days === 1 ? '1 paid day' : `${credit.days} paid days`;
  const parts = [credit.days > 0 ? days : null, credit.prepaidMonth > 0 ? 'a month paid ahead' : null].filter(
    (part): part is string => part !== null,
  );
  return `${planLabel} was withdrawn on ${today}; ${parts.join(' and ')} added as credit.`;
}

/** The sentence when the plan is offered again and the credit is taken back. */
export function archiveReversalNote(planLabel: string, today: DayKey): string {
  return `${planLabel} was offered again on ${today}; the credit for its withdrawal is taken back.`;
}
