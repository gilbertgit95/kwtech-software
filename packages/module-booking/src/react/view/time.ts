import { zonedHour } from '@kwtech/module-kit';
import { addBookingDays, type BookingDay, MINUTES_PER_DAY } from '../../domain/time.js';

/**
 * Times and days as a person reads and types them. Pure, so the day list, the
 * slot picker and the hours editor print a time ONE way.
 *
 * ⚠ EVERY FORMATTER TAKES THE WORKSPACE'S ZONE. A booking at 2:30 PM in the
 * shop is 2:30 PM on every screen, wherever the person reading it is.
 */

/** An instant as a clock time in the workspace: "2:30 PM". */
export function clockTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
}

/** An instant as a day and a time in the workspace: "Mon, Mar 3, 2:30 PM" — for a booking's history. */
export function dayAndTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * A calendar day in full: "Monday, March 3, 2031". A day has no zone, so it is
 * printed from noon UTC of itself — never through the viewer's zone, which
 * would print the day before for everybody west of UTC.
 */
export function dayText(day: BookingDay): string {
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** How a day is named beside today: "Today", "Tomorrow", "Yesterday", or its weekday and date. */
export function dayLabel(day: BookingDay, today: BookingDay): string {
  if (day === today) return 'Today';
  if (day === addBookingDays(today, 1)) return 'Tomorrow';
  if (day === addBookingDays(today, -1)) return 'Yesterday';
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

/** Minutes of a day as an `<input type="time">` value: 540 → "09:00". 1440, the end of the day, is "24:00". */
export function minutesToTimeValue(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** An `<input type="time">` value as minutes of a day, or null: "09:00" → 540. */
export function timeValueToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[2]) < 60 && minutes <= MINUTES_PER_DAY ? minutes : null;
}

/** Minutes of a day as a person reads them: 540 → "9:00 AM", 1440 → "midnight". */
export function minutesText(minutes: number): string {
  if (minutes === MINUTES_PER_DAY) return 'midnight';
  const hours = Math.floor(minutes / 60);
  const suffix = hours < 12 ? 'AM' : 'PM';
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(minutes % 60).padStart(2, '0')} ${suffix}`;
}

/** A length of time: 30 → "30 min", 60 → "1 hr", 90 → "1 hr 30 min". */
export function durationText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${minutes / 60} hr` : `${Math.floor(minutes / 60)} hr ${rest} min`;
}

/** One day of the strip above the list. */
export interface WeekStripDay {
  day: BookingDay;
  /** "Mon". */
  weekday: string;
  /** "3". */
  dayOfMonth: string;
  isToday: boolean;
  isSelected: boolean;
}

/**
 * The seven days of the week `day` is in, Monday first — one press to any of
 * them. Calendar arithmetic on days, which have no zone; `today` is the
 * workspace's, handed in.
 */
export function weekStrip(day: BookingDay, today: BookingDay): WeekStripDay[] {
  const selected = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(selected.getTime())) return [];
  // getUTCDay: 0 is Sunday. Monday is the week's first day here, so Sunday is six days in.
  const sinceMonday = (selected.getUTCDay() + 6) % 7;
  return [0, 1, 2, 3, 4, 5, 6].map((offset) => {
    const each = addBookingDays(day, offset - sinceMonday);
    const date = new Date(`${each}T12:00:00Z`);
    return {
      day: each,
      weekday: date.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' }),
      dayOfMonth: String(date.getUTCDate()),
      isToday: each === today,
      isSelected: each === day,
    };
  });
}

/** The parts of a day free times are grouped under. */
export type DayPart = 'Morning' | 'Afternoon' | 'Evening';

/** Before noon is the morning; from five, the evening. */
function dayPartOf(hour: number): DayPart {
  if (hour < 12) return 'Morning';
  return hour < 17 ? 'Afternoon' : 'Evening';
}

/**
 * Free times grouped by the part of the WORKSPACE's day they fall in, in order,
 * with empty parts left out — forty buttons in one run are searched, three
 * short rows are read.
 */
export function groupByDayPart(starts: readonly string[], timeZone: string): { part: DayPart; starts: string[] }[] {
  const groups: { part: DayPart; starts: string[] }[] = [
    { part: 'Morning', starts: [] },
    { part: 'Afternoon', starts: [] },
    { part: 'Evening', starts: [] },
  ];
  for (const start of starts) {
    const part = dayPartOf(zonedHour(new Date(start), timeZone));
    groups.find((group) => group.part === part)?.starts.push(start);
  }
  return groups.filter((group) => group.starts.length > 0);
}
