import { addMonthsAnchored, type DayKey, daysBetween } from './days.js';
import type { Centavos } from './money.js';
import type { Period } from './periods.js';
import type { Quote } from './quotes.js';
import type { PlatformBillingRefusal } from './refusals.js';
import type { BillingStanding, PriceRow } from './standing.js';

/**
 * RENEWING BY ITSELF FROM CREDIT (#129). With the owner's switch on, the daily
 * check renews the plan on its due date, but ONLY when the credit balance
 * pays the whole bill: then no money moves, and every peso it spends was
 * already checked by an approver when it came in (an approved payment, a
 * downgrade, an archive). That is why such a renewal needs no approver.
 *
 * Anything short of that is left to people, as today: the owner renews and
 * pays the difference, and the normal reminders carry on. This decides, the
 * write service does what it says, and the daily check tells the owner.
 */

/** Why an organization with auto-renew on was not renewed on its due date. Each is said to the owner once a period. */
export type AutoRenewSkip =
  /** The credit balance pays part of the bill: renew and pay the rest. */
  | 'credit_short'
  /** A request is already waiting (the owner asked, or changed plan): it is finished first. */
  | 'pending_request'
  /** The plan was archived: it can only be replaced, which is a choice. */
  | 'plan_archived'
  /** The plan has no price on the due date, so there is no bill to pay from credit. */
  | 'price_not_set'
  /** Access had already ended (a run missed every day of grace): a late renewal charges the access used, so a person renews. */
  | 'access_ended';

/** What the daily check does for one organization today. */
export type AutoRenewPlan =
  /** Nothing to do: the switch is off, the plan is not due, or the owner cancelled (they chose to leave). */
  | { kind: 'not_due' }
  /** Renew now, paid from credit. */
  | { kind: 'renew' }
  /** Due, but not renewed, and the owner is told why. `short` is what the credit lacks, for `credit_short`. */
  | { kind: 'skip'; reason: AutoRenewSkip; short: Centavos };

/** The inputs of `planAutoRenew`. */
export interface AutoRenewInput {
  enabled: boolean;
  standing: Pick<BillingStanding, 'hasPaidSubscription' | 'window'>;
  today: DayKey;
  hasPendingRequest: boolean;
  /** The owner cancelled this period: the plan ends with it, and nothing renews it. */
  cancelled: boolean;
  planArchived: boolean;
  /** The renewal priced today with the organization's balance, or why it cannot be. */
  renewal: Pick<Quote, 'total'> | { refused: PlatformBillingRefusal };
}

/**
 * Whether to renew `input`'s organization today (#129).
 *
 * ⚠ ON THE DUE DATE, NOT WHEN RENEWAL OPENS. Seven days earlier the owner may
 * still turn the switch off or change plan; on the due date the period ends,
 * so renewing then gives the most time and costs no access. A run missed on
 * the due date catches up on a grace day, still before access ends.
 */
export function planAutoRenew(input: AutoRenewInput): AutoRenewPlan {
  const window = input.standing.window;
  if (!input.enabled || !input.standing.hasPaidSubscription || !window || input.cancelled) return { kind: 'not_due' };
  if (input.today < window.periodEnd) return { kind: 'not_due' };
  if (input.today >= window.accessUntil) return skip('access_ended');
  if (input.planArchived) return skip('plan_archived');
  if (input.hasPendingRequest) return skip('pending_request');
  if ('refused' in input.renewal) {
    return input.renewal.refused === 'price_not_set' ? skip('price_not_set') : { kind: 'not_due' };
  }
  if (input.renewal.total > 0) return skip('credit_short', input.renewal.total);
  return { kind: 'renew' };
}

/** A skip, with what the credit lacks (0 unless it is short). */
function skip(reason: AutoRenewSkip, short: Centavos = 0): AutoRenewPlan {
  return { kind: 'skip', reason, short };
}

/** How far the credit balance pays the plan ahead (#129): "Credit ₱7,500, paid up to 7 Jun 2027". */
export interface PaidUpTo {
  /** Whole renewals the balance pays at today's price. */
  months: number;
  /** The due date after those renewals: the day access would next need paying for. */
  until: DayKey;
}

/**
 * The credit balance as a date (#129): how many whole renewals it pays at
 * `monthly`, counted on from the end of the period the row holds (which is
 * the paid-ahead one after an early renewal), on the same billing day. Null
 * when it pays none: no balance, a debt, or a plan with no price.
 *
 * ⚠ AT TODAY'S PRICE. A price rise moves the date earlier, and the owner is
 * told; the date is a forecast, never a promise written anywhere.
 */
export function paidUpTo(
  period: Pick<Period, 'end' | 'billingDay'>,
  monthly: Centavos | null,
  balance: Centavos,
): PaidUpTo | null {
  if (!monthly || monthly <= 0 || balance < monthly) return null;
  const months = Math.floor(balance / monthly);
  return { months, until: addMonthsAnchored(period.end, months, period.billingDay) };
}

/** How far a price change moved the paid-up-to date (#129): told to the owner once per change. */
export interface PaidUpToMoved {
  /** The day the new price took effect: the notice's key, so one change is said once. */
  effectiveFrom: DayKey;
  /** The date the credit paid up to at the old price, and at the new one (null: no longer a whole renewal). */
  before: DayKey;
  after: DayKey | null;
}

/** How long after a price takes effect its notice is still said: a missed run catches up, an old change is not news. */
export const PAID_UP_TO_NOTICE_DAYS = 7;

/**
 * Whether the price in force on `today` moved the credit's paid-up-to date
 * earlier than the price before it did (#129): a rise that took effect in the
 * last `PAID_UP_TO_NOTICE_DAYS` days. Null for no change, a fall (the date
 * only moves later, and nobody needs warning of that), or an old change.
 */
export function paidUpToMoved(input: {
  prices: readonly PriceRow[];
  planKey: string;
  today: DayKey;
  period: Pick<Period, 'end' | 'billingDay'>;
  balance: Centavos;
}): PaidUpToMoved | null {
  const rows = input.prices
    .filter((row) => row.planKey === input.planKey)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const current = rows.filter((row) => row.effectiveFrom <= input.today).at(-1);
  if (!current) return null;
  if (daysBetween(current.effectiveFrom, input.today) > PAID_UP_TO_NOTICE_DAYS) return null;
  const previous = rows.filter((row) => row.effectiveFrom < current.effectiveFrom).at(-1);
  if (!previous || current.monthly <= previous.monthly) return null;
  const before = paidUpTo(input.period, previous.monthly, input.balance);
  if (!before) return null;
  const after = paidUpTo(input.period, current.monthly, input.balance);
  if (after && after.until >= before.until) return null;
  return { effectiveFrom: current.effectiveFrom, before: before.until, after: after?.until ?? null };
}
