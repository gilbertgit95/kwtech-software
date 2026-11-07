import { zonedDayKey, zonedStartOfDay } from '@kwtech/module-kit';

/**
 * BILLING COUNTS CALENDAR DAYS IN THE PLATFORM'S TIME ZONE (PLATFORM-BILLING-PLAN
 * D17). Not a workspace's zone: billing is about organizations and the
 * platform, and one bill cannot follow two clocks. Every rule in this module
 * works on day keys (`YYYY-MM-DD`), and an instant becomes a day only here,
 * through the `zoned*` helpers, so "which day was this approval" is answered
 * once (principle 5).
 *
 * Day keys compare as strings, which is why every function takes and returns
 * them rather than `Date`s: a period, a grace end and a renewal window are
 * days, and an instant compared with a day is how an 11:30 PM approval in
 * Manila lands on the wrong day in UTC.
 */

/** A calendar day, `YYYY-MM-DD`. */
export type DayKey = string;

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DAY_MS = 86_400_000;

/** Whether `value` is a real calendar day ("2026-02-30" is not). */
export function isDayKey(value: string): boolean {
  const match = DAY_KEY.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parts(dayKey: DayKey): { year: number; month: number; day: number } {
  const match = DAY_KEY.exec(dayKey);
  if (!match || !isDayKey(dayKey)) throw new RangeError(`Not a day: '${dayKey}'.`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function toUtc(dayKey: DayKey): number {
  const { year, month, day } = parts(dayKey);
  return Date.UTC(year, month - 1, day);
}

function fromUtc(ms: number): DayKey {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `dayKey` moved by `days` (negative goes back). Calendar arithmetic, zone-free. */
export function addDays(dayKey: DayKey, days: number): DayKey {
  return fromUtc(toUtc(dayKey) + days * DAY_MS);
}

/** Whole days from `from` to `to`: 0 for the same day, negative when `to` is earlier. */
export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** How many days the month of `year`/`month` (1–12) has. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The platform's day of an instant: the only way an instant becomes a billing day. */
export function platformDay(instant: Date, timeZone: string): DayKey {
  return zonedDayKey(instant, timeZone);
}

/**
 * The instant a platform day begins, for writing a day back to a timestamp
 * column (`currentPeriodEnd`, `accessUntil`). Throws on a malformed day rather
 * than returning null: a period end that silently became "no date" would read
 * as no expiry at all.
 */
export function platformDayStart(dayKey: DayKey, timeZone: string): Date {
  const start = zonedStartOfDay(dayKey, timeZone);
  if (!start) throw new RangeError(`Not a day: '${dayKey}'.`);
  return start;
}

/** The day-of-month of a day key (1–31): what a subscription's billing day is. */
export function dayOfMonth(dayKey: DayKey): number {
  return parts(dayKey).day;
}

/**
 * `dayKey` moved by whole months, landing on `anchorDay` clamped to the end of
 * the month it reaches. The anchor is kept separately because clamping loses
 * it: the 31st of January → the 28th of February → the 31st of March, never the
 * 28th of March.
 */
export function addMonthsAnchored(dayKey: DayKey, months: number, anchorDay: number): DayKey {
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    throw new RangeError(`A billing day is 1 to 31, not ${anchorDay}.`);
  }
  const { year, month } = parts(dayKey);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const day = Math.min(anchorDay, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
