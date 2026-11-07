import { addDays, type DayKey, daysBetween } from './days.js';
import { type Period, periodFrom } from './periods.js';

/**
 * HOW LONG AN ORGANIZATION KEEPS ITS PLAN, AND WHY (PLATFORM-BILLING-PLAN §4
 * "Grace, hold and expiry").
 *
 * `accessUntil` = period end + grace + hold, as a day. Billing writes it on the
 * subscription row and the entitlement check compares only that with now (D14),
 * so access never depends on the daily job having run. Everything here is
 * the arithmetic behind that one date, and the words the screens show for it.
 */

/** How many days before the due date a renewal may be requested. */
export const RENEWAL_OPENS_DAYS_BEFORE = 7;

/** The platform default for the grace days; a super admin changes it in the settings (plan §4). */
export const DEFAULT_GRACE_DAYS = 7;

/** The trial of Basic a new organization's owner may take once (D2). */
export const TRIAL_DAYS = 14;

/** What a period end becomes, with its parts kept so the screen can show them (§6). */
export interface AccessWindow {
  periodEnd: DayKey;
  graceDays: number;
  holdDays: number;
  /** Excluded: the first day without access. */
  accessUntil: DayKey;
}

/** `accessUntil` and the parts it is made of. Throws on a negative count: a negative grace is a bug. */
export function accessWindow(periodEnd: DayKey, graceDays: number, holdDays = 0): AccessWindow {
  for (const [name, value] of [
    ['grace', graceDays],
    ['hold', holdDays],
  ] as const) {
    if (!Number.isInteger(value) || value < 0)
      throw new RangeError(`The ${name} days must be 0 or more, not ${value}.`);
  }
  return { periodEnd, graceDays, holdDays, accessUntil: addDays(periodEnd, graceDays + holdDays) };
}

/** What the inputs to a hold are: the request waiting for us, and this period's history. */
export interface HoldInput {
  /** The day payment details COVERING the bill were first entered, or null. */
  coveredOn: DayKey | null;
  /** This period already had a hold. */
  holdUsedThisPeriod: boolean;
  /** The request was submitted after a rejection in this period (loophole 10). */
  afterRejection: boolean;
}

/** Why a hold was or was not given: stored with the request, so its timeline can say (§6). */
export type HoldDecision =
  | { kind: 'held'; days: number }
  | { kind: 'not_held'; reason: 'no_covering_details' | 'details_after_grace' | 'hold_used' | 'after_rejection' };

/**
 * Whether a pending renewal holds access past grace, and for how long (D9).
 * Once per period, never after a rejection, only for details covering the bill
 * entered before grace ended, and for at most the grace days again.
 */
export function planHold(window: Pick<AccessWindow, 'periodEnd' | 'graceDays'>, input: HoldInput): HoldDecision {
  if (input.afterRejection) return { kind: 'not_held', reason: 'after_rejection' };
  if (input.holdUsedThisPeriod) return { kind: 'not_held', reason: 'hold_used' };
  if (input.coveredOn === null) return { kind: 'not_held', reason: 'no_covering_details' };
  if (input.coveredOn >= addDays(window.periodEnd, window.graceDays)) {
    return { kind: 'not_held', reason: 'details_after_grace' };
  }
  return { kind: 'held', days: window.graceDays };
}

/** Where a subscription stands on a given day. Derived, never stored as `past_due` (plan §4). */
export type SubscriptionStanding =
  | { kind: 'active'; daysToDue: number }
  /** Inside the 7 days before the due date: renewing is open. */
  | { kind: 'renewal_open'; daysToDue: number }
  /** Past the due date, inside grace: full access, with the days left. */
  | { kind: 'overdue'; daysLeft: number }
  /** Past grace, kept open by a hold for a renewal waiting for us. */
  | { kind: 'held'; daysLeft: number }
  /** Past `accessUntil`. */
  | { kind: 'expired'; daysAgo: number };

/** The standing of a subscription on `today`. */
export function standingOn(window: AccessWindow, today: DayKey): SubscriptionStanding {
  if (today >= window.accessUntil) return { kind: 'expired', daysAgo: daysBetween(window.accessUntil, today) };
  const graceEnd = addDays(window.periodEnd, window.graceDays);
  if (today >= graceEnd) return { kind: 'held', daysLeft: daysBetween(today, window.accessUntil) };
  if (today >= window.periodEnd) return { kind: 'overdue', daysLeft: daysBetween(today, graceEnd) };
  const daysToDue = daysBetween(today, window.periodEnd);
  if (daysToDue <= RENEWAL_OPENS_DAYS_BEFORE) return { kind: 'renewal_open', daysToDue };
  return { kind: 'active', daysToDue };
}

/** Whether a renewal may be requested on `today`: from 7 days before the due date, and any time after. */
export function canRequestRenewal(window: Pick<AccessWindow, 'periodEnd'>, today: DayKey): boolean {
  return daysBetween(today, window.periodEnd) <= RENEWAL_OPENS_DAYS_BEFORE;
}

/** What a renewal's approval does to the period, and whether its bill carried the access used. */
export type RenewalPlan =
  /** Before access ended: the next month from the current period's end, on the same row. */
  | { kind: 'continue'; period: Period }
  /** After access ended, the renewal on time: the delay was ours, so the month starts at approval (D10). */
  | { kind: 'restart_on_time'; period: Period }
  /** After access ended, the renewal late: the month starts at approval, and the bill charged the access used. */
  | { kind: 'restart_late'; period: Period; accessUsedDays: number };

/** The inputs of a renewal's approval. */
export interface RenewalInput {
  current: Period;
  window: AccessWindow;
  approvedOn: DayKey;
  /** Payment details covering the bill were entered before access ended (plan §4). */
  onTime: boolean;
}

/**
 * The period a renewal pays for, decided at approval (plan §4, D10).
 *
 * Before `accessUntil` the cycle continues and the billing day is kept. After
 * it, the month starts at approval and the billing day resets; a late renewal's
 * bill also charged the grace and hold days the organization had, so letting it
 * lapse every month gains nothing (loophole 9).
 */
export function planRenewal(input: RenewalInput): RenewalPlan {
  if (input.approvedOn < input.window.accessUntil) {
    return { kind: 'continue', period: periodFrom(input.current.end, input.current.billingDay) };
  }
  const period = periodFrom(input.approvedOn);
  if (input.onTime) return { kind: 'restart_on_time', period };
  return {
    kind: 'restart_late',
    period,
    accessUsedDays: daysBetween(input.window.periodEnd, input.window.accessUntil),
  };
}

/**
 * Whether payment details make a renewal on time: they cover the bill, and were
 * entered before access ended. A short amount topped up after is not (plan §4).
 */
export function isOnTime(coveredOn: DayKey | null, window: Pick<AccessWindow, 'accessUntil'>): boolean {
  return coveredOn !== null && coveredOn < window.accessUntil;
}
