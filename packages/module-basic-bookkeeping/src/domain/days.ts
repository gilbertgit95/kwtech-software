import { nextDayKey, zonedDayKey } from '@kwtech/module-kit';
import type { BooksDay, BooksRefusal } from '../types.js';

/**
 * The day an entry happened on — a day of the WORKSPACE's calendar, never an
 * instant (PLAN §13, 2026-09-29; `.claude/rules/typescript.md`).
 *
 * ⚠ CARRIED AS `YYYY-MM-DD` and stored as a Postgres `DATE`, never as a
 * timestamp at UTC midnight: 5 Oct 00:00 UTC is 4 Oct in New York, so a day
 * stored as an instant moves for everyone west of UTC. `module-task`'s
 * `prepareTaskDay` and its two converters, copied structurally — a module
 * never imports another.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

/**
 * A day as it arrives over the wire, or why it is refused: the shape AND a real
 * calendar day (`2026-02-30` is refused, not rolled into March), from 2000 on —
 * AND NOT AFTER `today`. Money that has not moved yet is not in the books.
 */
export function prepareBooksDay(raw: string, today: BooksDay): { day: BooksDay } | { refused: BooksRefusal } {
  const match = DAY.exec(raw);
  if (!match) return { refused: 'invalid_day' };
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 2000 || year > 2999) return { refused: 'invalid_day' };
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { refused: 'invalid_day' };
  }
  if (raw > today) return { refused: 'future_day' };
  return { day: raw };
}

/** Whether `raw` is a real `YYYY-MM-DD` day, with no "not in the future" rule (a filter, a stored watermark). */
export function isBooksDay(raw: string): boolean {
  return 'day' in prepareBooksDay(raw, '2999-12-31');
}

/**
 * The day as Prisma writes it to a `DATE` column: midnight UTC of that day,
 * which Postgres truncates to the day itself. Only ever used at the database
 * boundary, and only with `booksDayFromDate` on the way back.
 */
export function booksDayToDate(day: BooksDay): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** A `DATE` column as Prisma reads it (midnight UTC) back to its day. */
export function booksDayFromDate(date: Date): BooksDay {
  return date.toISOString().slice(0, 10);
}

/** The WORKSPACE's today: what "not in the future" and "this month" are measured against. */
export function workspaceBooksDay(now: Date, timeZone: string): BooksDay {
  return zonedDayKey(now, timeZone);
}

/** The day after `day`. Calendar arithmetic, zone-free (module-kit's). */
export function nextBooksDay(day: BooksDay): BooksDay {
  return nextDayKey(day);
}

/** The day before `day`. Zone-free: a day key has no zone, so UTC arithmetic on it is exact. */
export function previousBooksDay(day: BooksDay): BooksDay {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** The month of a day, `YYYY-MM`. */
export function monthOfDay(day: BooksDay): string {
  return day.slice(0, 7);
}

/** Whether `raw` is a month, `YYYY-MM`, from 2000 on. */
export function isBooksMonth(raw: string): boolean {
  return isBooksDay(`${raw}-01`) && raw.length === 7;
}

/** The first and last day of a month `YYYY-MM`. */
export function monthBounds(month: string): { fromDay: BooksDay; toDay: BooksDay } {
  const [year, index] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return { fromDay: `${month}-01`, toDay: `${month}-${String(last).padStart(2, '0')}` };
}

/** The `count` months ending with `month`'s, oldest first: `('2026-02', 3)` → `2025-12, 2026-01, 2026-02`. */
export function monthsEndingWith(month: string, count: number): string[] {
  const [year, index] = [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1];
  const months: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const date = new Date(Date.UTC(year, index - back, 1));
    months.push(date.toISOString().slice(0, 7));
  }
  return months;
}
