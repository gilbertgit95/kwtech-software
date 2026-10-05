import { BOOKING_WINDOWS_PER_DAY_MAX } from '../../domain/hours.js';
import type { BookingWindow } from '../../types.js';
import { minutesText } from './time.js';

/**
 * A resource's week as the hours editor holds it — a row per weekday, each
 * with its stretches — and as a line of text. Pure: the editor's every rule is
 * here, and the server validates the result again (`prepareBookingHours`).
 */

/** Monday first: a working week reads that way, though the data numbers Sunday 0. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday] ?? '';
}

export interface StretchDraft {
  /**
   * The row's identity while it is being edited: a stretch has no id of its
   * own, and its times change under the person typing them. Unique within its
   * day, and never sent anywhere.
   */
  key: string;
  startMinute: number;
  endMinute: number;
}

export interface DayHoursDraft {
  weekday: number;
  /** Empty: closed that day. */
  stretches: StretchDraft[];
}

/** A key no stretch of this day holds yet. */
function nextKey(stretches: readonly StretchDraft[]): string {
  const used = stretches.map((stretch) => Number(stretch.key.slice(1))).filter((value) => Number.isInteger(value));
  return `s${used.length === 0 ? 0 : Math.max(...used) + 1}`;
}

/** The week as seven rows, Monday first, each with its stretches in order. */
export function weekDraft(hours: readonly BookingWindow[]): DayHoursDraft[] {
  return WEEKDAY_ORDER.map((weekday) => ({
    weekday,
    stretches: hours
      .filter((window) => window.weekday === weekday)
      .map((window) => ({ startMinute: window.startMinute, endMinute: window.endMinute }))
      .sort((a, b) => a.startMinute - b.startMinute)
      .map((stretch, index) => ({ key: `s${index}`, ...stretch })),
  }));
}

/** The draft as the windows the API takes. */
export function weekWindows(draft: readonly DayHoursDraft[]): BookingWindow[] {
  return draft.flatMap((day) =>
    day.stretches.map((stretch) => ({
      weekday: day.weekday,
      startMinute: stretch.startMinute,
      endMinute: stretch.endMinute,
    })),
  );
}

/** What a day that opens gets first: nine to five. */
const DEFAULT_STRETCH = { startMinute: 9 * 60, endMinute: 17 * 60 };

/** Opens a closed day (nine to five), or closes an open one. */
export function toggleDay(draft: readonly DayHoursDraft[], weekday: number): DayHoursDraft[] {
  return draft.map((day) => {
    if (day.weekday !== weekday) return day;
    return { ...day, stretches: day.stretches.length === 0 ? [{ key: 's0', ...DEFAULT_STRETCH }] : [] };
  });
}

/** Whether a day can take another stretch. */
export function canAddStretch(day: DayHoursDraft): boolean {
  const last = day.stretches.at(-1);
  return day.stretches.length < BOOKING_WINDOWS_PER_DAY_MAX && (last === undefined || last.endMinute <= 23 * 60);
}

/** Adds a stretch after the day's last one: an hour's break, then up to four hours, inside the day. */
export function addStretch(draft: readonly DayHoursDraft[], weekday: number): DayHoursDraft[] {
  return draft.map((day) => {
    if (day.weekday !== weekday || !canAddStretch(day)) return day;
    const last = day.stretches.at(-1);
    if (!last) return { ...day, stretches: [{ key: 's0', ...DEFAULT_STRETCH }] };
    const startMinute = Math.min(last.endMinute + 60, 23 * 60);
    const added = { key: nextKey(day.stretches), startMinute, endMinute: Math.min(startMinute + 240, 1440) };
    return { ...day, stretches: [...day.stretches, added] };
  });
}

export function removeStretch(draft: readonly DayHoursDraft[], weekday: number, key: string): DayHoursDraft[] {
  return draft.map((day) =>
    day.weekday === weekday ? { ...day, stretches: day.stretches.filter((stretch) => stretch.key !== key) } : day,
  );
}

export function setStretch(
  draft: readonly DayHoursDraft[],
  weekday: number,
  key: string,
  patch: { startMinute?: number; endMinute?: number },
): DayHoursDraft[] {
  return draft.map((day) =>
    day.weekday === weekday
      ? {
          ...day,
          stretches: day.stretches.map((stretch) => (stretch.key === key ? { ...stretch, ...patch } : stretch)),
        }
      : day,
  );
}

/** Copies one day's stretches onto every other day that is open — "the same hours all week" in one press. */
export function copyToOpenDays(draft: readonly DayHoursDraft[], weekday: number): DayHoursDraft[] {
  const source = draft.find((day) => day.weekday === weekday);
  if (!source) return [...draft];
  return draft.map((day) =>
    day.weekday === weekday || day.stretches.length === 0
      ? day
      : { ...day, stretches: source.stretches.map((stretch) => ({ ...stretch })) },
  );
}

/**
 * What is wrong with one day of the draft, as a sentence — or null. The same
 * rules the server runs, said where the mistake is rather than after a save.
 */
export function dayHoursError(day: DayHoursDraft): string | null {
  for (const stretch of day.stretches) {
    if (stretch.startMinute >= stretch.endMinute) return 'A stretch must end after it starts.';
  }
  const sorted = [...day.stretches].sort((a, b) => a.startMinute - b.startMinute);
  for (let i = 1; i < sorted.length; i += 1) {
    const [before, after] = [sorted[i - 1], sorted[i]];
    if (before && after && after.startMinute < before.endMinute) return 'These stretches overlap.';
  }
  return null;
}

/** One day's stretches as text: "9:00 AM – 12:00 PM, 1:00 PM – 5:00 PM", or "Closed". */
export function dayHoursText(stretches: readonly { startMinute: number; endMinute: number }[]): string {
  if (stretches.length === 0) return 'Closed';
  return stretches
    .map((stretch) => `${minutesText(stretch.startMinute)} – ${minutesText(stretch.endMinute)}`)
    .join(', ');
}

/**
 * A resource's week in a line or two, for a list: days with the same hours are
 * grouped ("Mon–Fri 9:00 AM – 5:00 PM · Sat 9:00 AM – 12:00 PM"), and a week
 * with no hours at all says so — a resource like that can never be booked.
 */
export function weekSummary(hours: readonly BookingWindow[]): string {
  const days = weekDraft(hours).map((day) => ({ weekday: day.weekday, text: dayHoursText(day.stretches) }));
  if (days.every((day) => day.text === 'Closed')) return 'No opening hours yet — it cannot be booked.';

  const groups: { from: number; to: number; text: string }[] = [];
  for (const day of days) {
    const last = groups.at(-1);
    if (last && last.text === day.text) last.to = day.weekday;
    else groups.push({ from: day.weekday, to: day.weekday, text: day.text });
  }
  return groups
    .filter((group) => group.text !== 'Closed')
    .map((group) => {
      const span =
        group.from === group.to
          ? (WEEKDAY_SHORT[group.from] ?? '')
          : `${WEEKDAY_SHORT[group.from] ?? ''}–${WEEKDAY_SHORT[group.to] ?? ''}`;
      return `${span} ${group.text}`;
    })
    .join(' · ');
}
