import type { DayKey } from './days.js';
import { assertCentavos, type Centavos, prorate } from './money.js';
import { daysInPeriod, daysLeft, type Period } from './periods.js';

/**
 * WHAT A REQUEST COSTS, AS THE LINES A BILL PRINTS (PLATFORM-BILLING-PLAN §4,
 * §7). Every bill is built here, so the preview the owner sees, the bill that
 * is issued and the tests read the same arithmetic (principle 5).
 *
 * Payment comes BEFORE approval, so fairness is done with credit, never with a
 * bill totalled after the fact: an unused part of a plan becomes credit, and
 * credit is spent on the next bill. Credit never becomes cash.
 */

export type QuoteLineKind =
  /** The plan's full month: a subscribe, a renewal, a replacement. */
  | 'month'
  /** The new plan's days left in the period (a plan change). Positive. */
  | 'new_plan_days'
  /** The old plan's unused days in the period (a plan change). Negative. */
  | 'old_plan_unused'
  /** A month already paid ahead on the old plan, given back on a change (D11). Negative. */
  | 'prepaid_month'
  /** Access used past the period end before a late renewal: grace and any hold (D10). Positive. */
  | 'access_used'
  /** Credit balance spent on this bill. Negative. */
  | 'credit_applied'
  /** A negative balance (owed after a void) added to this bill. Positive. */
  | 'owed'
  /**
   * Months bought ahead at once (#129), at the month's price: paid with the
   * bill and held as credit on approval, which later renewals spend. Positive.
   * After the credit lines, so a balance already held is never spent on it.
   */
  | 'paid_ahead';

/** One line of a bill. `days` is set on the lines that are a count of days, `months` on `paid_ahead`. */
export interface QuoteLine {
  kind: QuoteLineKind;
  amount: Centavos;
  days?: number;
  months?: number;
}

/** The most months one request pays for (#129): a year. Past it, a mistyped number would bill a decade. */
export const PLATFORM_BILLING_MONTHS_MAX = 12;

/** The choices the Renew and Subscribe panels offer (#129). Any whole number from 1 to the maximum is accepted. */
export const PLATFORM_BILLING_MONTH_CHOICES: readonly number[] = [1, 3, 6, 12];

/** Whether `months` is a number of months one request may pay for. */
export function isMonths(months: number): boolean {
  return Number.isSafeInteger(months) && months >= 1 && months <= PLATFORM_BILLING_MONTHS_MAX;
}

/**
 * A month's quote with `months - 1` more bought ahead (#129). The extra is a
 * line of its own AFTER the quote is settled against the balance: credit
 * already held pays for this month, never for months being bought, which
 * would spend it only to hand it back as the same credit.
 */
export function withPaidAhead(quote: Quote, monthly: Centavos, months: number): Quote {
  const extra = months - 1;
  if (extra <= 0) return quote;
  const amount = assertCentavos(monthly) * extra;
  return {
    ...quote,
    lines: [...quote.lines, { kind: 'paid_ahead', amount, months: extra }],
    total: quote.total + amount,
  };
}

/** What a bill's lines bought ahead (#129): the credit its approval adds for those months. */
export function paidAheadOf(lines: readonly Pick<QuoteLine, 'kind' | 'amount'>[]): Centavos {
  return lines.reduce((sum, line) => (line.kind === 'paid_ahead' ? sum + line.amount : sum), 0);
}

/**
 * A bill's arithmetic. `total` is what to pay, never below zero; whatever the
 * credits exceed the charges by is `creditAdded`, and `creditUsed` is what
 * left the balance (positive), so the ledger is two entries, never a guess.
 */
export interface Quote {
  lines: readonly QuoteLine[];
  total: Centavos;
  creditUsed: Centavos;
  creditAdded: Centavos;
  /**
   * The debt this bill carries as its `owed` line, cleared from the balance
   * when the bill is paid. With `creditUsed` and `creditAdded` it is every
   * ledger entry the bill makes: balance after = balance − used + added + cleared.
   */
  owedCleared: Centavos;
}

/**
 * Settle a set of charge and credit lines against the organization's credit
 * balance. A negative balance is money owed (a voided receipt's credit already
 * spent, plan §4) and is added as a line, never hidden in the total.
 */
function settle(lines: readonly QuoteLine[], creditBalance: Centavos): Quote {
  assertCentavos(creditBalance, 'A credit balance');
  const all: QuoteLine[] = [...lines];
  const owedCleared = Math.max(0, -creditBalance);
  if (owedCleared > 0) all.push({ kind: 'owed', amount: owedCleared });
  const net = all.reduce((sum, line) => sum + line.amount, 0);
  if (net <= 0) return { lines: all, total: 0, creditUsed: 0, creditAdded: -net, owedCleared };
  const creditUsed = Math.min(Math.max(0, creditBalance), net);
  if (creditUsed > 0) all.push({ kind: 'credit_applied', amount: -creditUsed });
  return { lines: all, total: net - creditUsed, creditUsed, creditAdded: 0, owedCleared };
}

/** A full month of `monthly` (subscribe, replacement), less any credit. */
export function quoteMonth(monthly: Centavos, creditBalance: Centavos): Quote {
  return settle([{ kind: 'month', amount: assertCentavos(monthly) }], creditBalance);
}

/** What a late renewal adds for the access used past the period end. */
export interface AccessUsed {
  /** Grace and hold days the organization had after its period ended. */
  days: number;
  /** The old plan's monthly price, and the old period, for the daily rate. */
  oldMonthly: Centavos;
  oldPeriod: Period;
}

/**
 * A renewal: the next month, plus the access used past the period end when
 * the renewal is not on time (D10, plan §4), less any credit.
 */
export function quoteRenewal(monthly: Centavos, creditBalance: Centavos, accessUsed?: AccessUsed): Quote {
  const lines: QuoteLine[] = [{ kind: 'month', amount: assertCentavos(monthly) }];
  if (accessUsed && accessUsed.days > 0) {
    lines.push({
      kind: 'access_used',
      amount: prorate(accessUsed.oldMonthly, accessUsed.days, daysInPeriod(accessUsed.oldPeriod)),
      days: accessUsed.days,
    });
  }
  return settle(lines, creditBalance);
}

/** The inputs of a plan change. */
export interface PlanChangeInput {
  oldMonthly: Centavos;
  newMonthly: Centavos;
  /** The current period, which the change runs to the end of (the billing day is kept). */
  period: Period;
  /** The day the change is priced for: submission for an upgrade, approval for a downgrade (D12). */
  day: DayKey;
  creditBalance: Centavos;
  /** A month already paid ahead on the old plan (D11), at the price it was paid. */
  prepaidMonth?: Centavos;
}

/**
 * A plan change in the middle of a period: the new plan's days left, less the
 * old plan's unused days, less a paid-ahead month, less credit.
 *
 * Basic 1,000 → Pro 1,500 on day 15 of 30 is 750 − 500 = 250 to pay; Pro →
 * Basic is 500 − 750, so 0 to pay and 250 of credit (plan §4).
 */
export function quotePlanChange(input: PlanChangeInput): Quote {
  const whole = daysInPeriod(input.period);
  const left = daysLeft(input.period, input.day);
  const lines: QuoteLine[] = [
    { kind: 'old_plan_unused', amount: -prorate(assertCentavos(input.oldMonthly), left, whole), days: left },
    { kind: 'new_plan_days', amount: prorate(assertCentavos(input.newMonthly), left, whole), days: left },
  ];
  if (input.prepaidMonth && input.prepaidMonth > 0) {
    lines.push({ kind: 'prepaid_month', amount: -assertCentavos(input.prepaidMonth) });
  }
  return settle(lines, input.creditBalance);
}

/** Whether a change from `oldMonthly` to `newMonthly` is an upgrade: it decides when its amount is fixed (D12). */
export function isUpgrade(oldMonthly: Centavos, newMonthly: Centavos): boolean {
  return newMonthly > oldMonthly;
}

/**
 * The credit an upgrade earns for the days between the day it was priced
 * (submission) and the day it was approved (D12): the owner paid the price
 * difference for those days, and was still on the old plan. Zero when
 * approved on the day it was priced, or for a change that is not an upgrade.
 */
export function approvalLagCredit(
  change: Pick<PlanChangeInput, 'oldMonthly' | 'newMonthly' | 'period'>,
  pricedOn: DayKey,
  approvedOn: DayKey,
): Centavos {
  if (!isUpgrade(change.oldMonthly, change.newMonthly)) return 0;
  const lag = daysLeft(change.period, pricedOn) - daysLeft(change.period, approvedOn);
  if (lag <= 0) return 0;
  return prorate(change.newMonthly - change.oldMonthly, lag, daysInPeriod(change.period));
}

/**
 * The credit an organization is owed when its plan is archived mid-period:
 * the paid days from the archive date to the period's end, at the plan's
 * price (plan §4, "An organization on an archived plan replaces it").
 */
export function archiveCredit(monthly: Centavos, period: Period, archivedOn: DayKey): Centavos {
  return prorate(assertCentavos(monthly), daysLeft(period, archivedOn), daysInPeriod(period));
}
