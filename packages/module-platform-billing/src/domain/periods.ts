import { addDays, addMonthsAnchored, type DayKey, dayOfMonth, daysBetween } from './days.js';

/**
 * A SUBSCRIPTION PERIOD IS ONE CALENDAR MONTH WITH A FIXED BILLING DAY
 * (PLATFORM-BILLING-PLAN §4 "Periods").
 *
 * A period runs from `start` (included) to `end` (excluded): the end day is the
 * first day of the next period and the due date. The billing day never moves
 * for a plan change, a late payment or an early renewal; only a subscribe, a
 * renewal after expiry and a replacement of an archived plan set a new one.
 */
export interface Period {
  start: DayKey;
  /** Excluded: the next period's first day, and the due date. */
  end: DayKey;
  /** 1–31. Kept apart from `start` because a clamped month loses it (the 31st in February). */
  billingDay: number;
}

/** The period starting on `start`, keeping `billingDay` (default: `start`'s own day). */
export function periodFrom(start: DayKey, billingDay: number = dayOfMonth(start)): Period {
  return { start, end: addMonthsAnchored(start, 1, billingDay), billingDay };
}

/** The period after `period`, on the same billing day. What a renewal before expiry pays for. */
export function nextPeriod(period: Period): Period {
  return periodFrom(period.end, period.billingDay);
}

/** How many days `period` has: 28 to 31. The divisor of every prorated line. */
export function daysInPeriod(period: Period): number {
  return daysBetween(period.start, period.end);
}

/**
 * Days of `period` from `day` to its end, counting `day` itself: the day of a
 * plan change belongs to the NEW plan. Clamped to 0 after the end and to the
 * whole period before its start.
 */
export function daysLeft(period: Period, day: DayKey): number {
  if (day < period.start) return daysInPeriod(period);
  return Math.max(0, daysBetween(day, period.end));
}

/** Whether `day` falls inside `period`. */
export function isWithin(period: Period, day: DayKey): boolean {
  return day >= period.start && day < period.end;
}

/** The last day `period` covers (the day before its end), for display: "Paid through <date>". */
export function lastDayOf(period: Period): DayKey {
  return addDays(period.end, -1);
}
