import { nextDayKey, zonedDayKey, zonedMinuteOfDay, zonedStartOfDay } from '@kwtech/module-kit';
import type { BookingRefusal } from '../types.js';

/**
 * Days, minutes of a day, and instants (BOOKING-PLAN §3).
 *
 *   opening hours — MINUTES OF THE WORKSPACE'S DAY (540 is 9:00 there)
 *   a closed day  — a DAY, `YYYY-MM-DD`, with no zone
 *   a booking     — INSTANTS, start and end
 *
 * ⚠ EVERY DAY AND TIME IS THE WORKSPACE'S. Which day an instant belongs to,
 * and what 9:00 means, are answered with the workspace's zone and module-kit's
 * `zoned*` helpers — never the server's clock (UTC) and never the browser's. A
 * booking made at 11 PM in Manila lands on that day, while the server already
 * calls it tomorrow.
 */

/** A calendar day of the workspace, `YYYY-MM-DD`. */
export type BookingDay = string;

export const MINUTES_PER_DAY = 1440;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

function utcMidnight(day: BookingDay): number | null {
  const match = DAY.exec(day);
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const instant = new Date(Date.UTC(year, month - 1, date));
  // A real calendar day: `2026-02-30` is refused, not rolled into March.
  if (instant.getUTCFullYear() !== year || instant.getUTCMonth() !== month - 1 || instant.getUTCDate() !== date) {
    return null;
  }
  return instant.getTime();
}

/** A day as it arrives over the wire, validated: the shape AND a real calendar day. */
export function prepareBookingDay(raw: string | null | undefined): { day: BookingDay } | { refused: BookingRefusal } {
  if (raw == null || utcMidnight(raw) === null) return { refused: 'invalid_day' };
  const year = Number(raw.slice(0, 4));
  if (year < 2000 || year > 2999) return { refused: 'invalid_day' };
  return { day: raw };
}

/**
 * The day as Prisma writes it to a `DATE` column: midnight UTC of that day,
 * which Postgres truncates to the day itself. Only ever used at the database
 * boundary, and only with `bookingDayFromDate` on the way back.
 */
export function bookingDayToDate(day: BookingDay): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** A `DATE` column as Prisma reads it (midnight UTC) back to its day. */
export function bookingDayFromDate(date: Date): BookingDay {
  return date.toISOString().slice(0, 10);
}

/** The workspace's calendar day of an instant — what "today's bookings" is measured against. */
export function workspaceBookingDay(instant: Date, timeZone: string): BookingDay {
  return zonedDayKey(instant, timeZone);
}

/** The day of the week of a calendar day: 0 is Sunday. A day has no zone, so neither does this. */
export function bookingWeekday(day: BookingDay): number | null {
  const midnight = utcMidnight(day);
  return midnight === null ? null : new Date(midnight).getUTCDay();
}

/** `day` plus `count` calendar days. Calendar arithmetic, zone-free. */
export function addBookingDays(day: BookingDay, count: number): BookingDay {
  const midnight = utcMidnight(day);
  if (midnight === null) return day;
  return new Date(midnight + count * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * The instants one workspace day covers, `[from, until)` — what a per-day query
 * asks for. Null for a malformed day.
 */
export function bookingDayRange(day: BookingDay, timeZone: string): { from: Date; until: Date } | null {
  const from = zonedStartOfDay(day, timeZone);
  const until = zonedStartOfDay(nextDayKey(day), timeZone);
  return from && until ? { from, until } : null;
}

/**
 * The instant at which it is `minuteOfDay` on `day` in the workspace: "9:00 on
 * the 5th" as a moment. `minuteOfDay` may be 1440, the end of the day.
 *
 * Found the way module-kit finds a day's start: guess, read the guess back in
 * the zone, and correct by the difference, twice. On most days the first guess
 * is right; the correction is for a day that is not 24 hours long (a
 * daylight-saving change). ⚠ A wall time that does not exist on such a day
 * (02:30 where the clock jumps from 02:00 to 03:00) settles on a nearby instant
 * rather than failing — a shop open through a skipped hour still opens.
 */
export function zonedInstant(day: BookingDay, minuteOfDay: number, timeZone: string): Date | null {
  const start = zonedStartOfDay(day, timeZone);
  const wantedDay = utcMidnight(day);
  if (!start || wantedDay === null) return null;
  let guess = start.getTime() + minuteOfDay * MS_PER_MINUTE;
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = new Date(guess);
    const seenDay = utcMidnight(zonedDayKey(seen, timeZone)) ?? wantedDay;
    const seenMinutes = ((seenDay - wantedDay) / MS_PER_DAY) * MINUTES_PER_DAY + zonedMinuteOfDay(seen, timeZone);
    guess += (minuteOfDay - seenMinutes) * MS_PER_MINUTE;
  }
  return new Date(guess);
}

/**
 * A booking's start as it arrives over the wire: an ISO instant WITH its zone
 * (`…Z` or an offset), on a whole minute. Null when it is not one.
 *
 * ⚠ A zone is required. `2026-10-05T09:00` with none is read by `Date` in the
 * SERVER's zone, which would book nine in the morning UTC for a shop in Manila.
 */
export function parseBookingInstant(raw: string | null | undefined): Date | null {
  if (raw == null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/u.test(raw)) return null;
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) return null;
  return instant.getTime() % MS_PER_MINUTE === 0 ? instant : null;
}

/** `minutes` after `instant`. Negative goes back. */
export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MS_PER_MINUTE);
}
