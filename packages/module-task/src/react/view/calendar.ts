import { addDays, type TaskDay } from '../../domain/dates.js';

/**
 * The date picker's calendar rules — pure, and tested
 * (`test/calendar.test.ts`), so the component only draws.
 *
 * ⚠ Everything here is a calendar DAY (`YYYY-MM-DD`) or a month (`YYYY-MM`),
 * with no zone of its own. The arithmetic is done at UTC midnight and read back
 * with the UTC getters, so the machine's zone never moves a day. Which day is
 * "today" is not decided here: the caller passes the workspace's
 * (`workspaceTaskDay`).
 */

/** A calendar month, `YYYY-MM`. */
export type CalendarMonth = string;

/** The week's columns, Sunday first — the calendar this app's workspaces use. */
export const WEEKDAY_LABELS: readonly { short: string; long: string }[] = [
  { short: 'Su', long: 'Sunday' },
  { short: 'Mo', long: 'Monday' },
  { short: 'Tu', long: 'Tuesday' },
  { short: 'We', long: 'Wednesday' },
  { short: 'Th', long: 'Thursday' },
  { short: 'Fr', long: 'Friday' },
  { short: 'Sa', long: 'Saturday' },
];

const DAYS_IN_WEEK = 7;

function utcDate(day: TaskDay): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** The month a day is in. */
export function monthOf(day: TaskDay): CalendarMonth {
  return day.slice(0, 7);
}

/** `month` plus `count` months. */
export function shiftMonth(month: CalendarMonth, count: number): CalendarMonth {
  const date = utcDate(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + count);
  return date.toISOString().slice(0, 7);
}

/** One cell of the month's grid: a day, and whether it belongs to the month shown. */
export interface CalendarCell {
  day: TaskDay;
  inMonth: boolean;
}

/**
 * The month as whole weeks, Sunday first: the days before the 1st and after the
 * last are the neighbouring months', marked `inMonth: false`, so every row has
 * seven cells and a day keeps its weekday column.
 */
export function monthCells(month: CalendarMonth): CalendarCell[] {
  const first = `${month}-01`;
  const start = addDays(first, -utcDate(first).getUTCDay());
  const cells: CalendarCell[] = [];
  let day = start;
  // Until the month has run out AND the row it ended in is full.
  while (cells.length === 0 || cells.length % DAYS_IN_WEEK !== 0 || monthOf(day) === month) {
    cells.push({ day, inMonth: monthOf(day) === month });
    day = addDays(day, 1);
  }
  return cells;
}

/**
 * A day in words, read at UTC so the machine's zone cannot move it. The comma
 * some browsers put after the weekday ("Fri, 9 Oct") is dropped, so the label
 * is the same words everywhere.
 */
function inWords(day: TaskDay, options: Intl.DateTimeFormatOptions): string {
  return utcDate(day)
    .toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' })
    .replace(/,/gu, '');
}

/** "October 2026". */
export function monthLabel(month: CalendarMonth): string {
  return inWords(`${month}-01`, { month: 'long', year: 'numeric' });
}

/** "Fri 9 Oct 2026" — what the picker's button shows. */
export function shortDayLabel(day: TaskDay): string {
  return inWords(day, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Friday 9 October 2026" — a day's full name, for a screen reader. */
export function longDayLabel(day: TaskDay): string {
  return inWords(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** The same day of the month `count` months on, or that month's last day when it is shorter (31 Jan → 28 Feb). */
function addMonths(day: TaskDay, count: number): TaskDay {
  const month = shiftMonth(monthOf(day), count);
  const lastDay = Number(addDays(`${shiftMonth(month, 1)}-01`, -1).slice(8));
  const wanted = Math.min(Number(day.slice(8)), lastDay);
  return `${month}-${String(wanted).padStart(2, '0')}`;
}

/**
 * The day a key moves the calendar's focus to, from `day`: ← → a day, ↑ ↓ a
 * week, Home and End the week's first and last day, Page Up and Page Down a
 * month. Null for any other key, which stays the browser's.
 */
export function calendarKeyMove(day: TaskDay, key: string): TaskDay | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(day, -1);
    case 'ArrowRight':
      return addDays(day, 1);
    case 'ArrowUp':
      return addDays(day, -DAYS_IN_WEEK);
    case 'ArrowDown':
      return addDays(day, DAYS_IN_WEEK);
    case 'Home':
      return addDays(day, -utcDate(day).getUTCDay());
    case 'End':
      return addDays(day, DAYS_IN_WEEK - 1 - utcDate(day).getUTCDay());
    case 'PageUp':
      return addMonths(day, -1);
    case 'PageDown':
      return addMonths(day, 1);
    default:
      return null;
  }
}
