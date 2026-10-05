import type { BookingMinuteRange, BookingRefusal, BookingWindow } from '../types.js';
import { prepareBookingLine } from './text.js';
import { type BookingDay, MINUTES_PER_DAY, prepareBookingDay } from './time.js';

/**
 * When a resource can be booked (BOOKING-PLAN §2): its WEEKLY HOURS, minus the
 * EXCEPTIONS on a given day (a day off, a holiday, a blocked hour).
 *
 * ⚠ SLOTS ARE NEVER STORED. What is free is worked out from these and from the
 * bookings already made, every time it is asked — so there is one source of
 * truth and nothing to keep in step.
 */

/** A lunch break makes two windows, a split shift three. More than this in one day is a mistake, not a schedule. */
export const BOOKING_WINDOWS_PER_DAY_MAX = 4;

/** In code points. Why the day is closed: "Holiday", "Machine service". */
export const BOOKING_EXCEPTION_NOTE_MAX = 120;

const isMinute = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MINUTES_PER_DAY;

/**
 * A resource's whole week as it will be stored: every window a real stretch of
 * a day, no two on one day overlapping, sorted. Refused whole, never trimmed —
 * hours that were silently changed are hours the shop did not set.
 *
 * Two windows that TOUCH (9:00–12:00 and 12:00–17:00) are allowed and kept as
 * typed. A booking may not run from one into the other: each window is a
 * stretch somebody chose to end.
 */
export function prepareBookingHours(
  raw: readonly BookingWindow[],
): { hours: BookingWindow[] } | { refused: BookingRefusal } {
  const hours: BookingWindow[] = [];
  for (const window of raw) {
    const weekdayValid = Number.isInteger(window.weekday) && window.weekday >= 0 && window.weekday <= 6;
    if (!weekdayValid || !isMinute(window.startMinute) || !isMinute(window.endMinute)) {
      return { refused: 'invalid_hours' };
    }
    if (window.startMinute >= window.endMinute) return { refused: 'invalid_hours' };
    hours.push({ weekday: window.weekday, startMinute: window.startMinute, endMinute: window.endMinute });
  }
  hours.sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);

  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const day = hours.filter((window) => window.weekday === weekday);
    if (day.length > BOOKING_WINDOWS_PER_DAY_MAX) return { refused: 'invalid_hours' };
    for (let i = 1; i < day.length; i += 1) {
      const [before, after] = [day[i - 1], day[i]];
      if (before && after && after.startMinute < before.endMinute) return { refused: 'invalid_hours' };
    }
  }
  return { hours };
}

/** An exception as the service is handed it. Both minutes null: the whole day. */
export interface BookingExceptionInput {
  day: string;
  startMinute?: number | null | undefined;
  endMinute?: number | null | undefined;
  note?: string | null | undefined;
}

export interface PreparedBookingException {
  day: BookingDay;
  /** Null with `endMinute`: closed the whole day. */
  startMinute: number | null;
  endMinute: number | null;
  note: string;
}

/**
 * A closed day or a closed stretch of one, validated. The two minutes come
 * together or not at all: a start with no end is not a stretch.
 */
export function prepareBookingException(
  input: BookingExceptionInput,
): { exception: PreparedBookingException } | { refused: BookingRefusal } {
  const prepared = prepareBookingDay(input.day);
  if ('refused' in prepared) return { refused: 'invalid_exception' };
  const note = prepareBookingLine(input.note ?? '', BOOKING_EXCEPTION_NOTE_MAX, { allowEmpty: true });
  if (note === null) return { refused: 'invalid_exception' };

  const [start, end] = [input.startMinute ?? null, input.endMinute ?? null];
  if (start === null && end === null) {
    return { exception: { day: prepared.day, startMinute: null, endMinute: null, note } };
  }
  if (!isMinute(start) || !isMinute(end) || start >= end) return { refused: 'invalid_exception' };
  return { exception: { day: prepared.day, startMinute: start, endMinute: end, note } };
}

/**
 * The stretches a resource is open on ONE day: its hours for that weekday, with
 * every closure cut out of them. Sorted, and empty when it is closed all day.
 *
 * `closures` are the exceptions that apply to this resource on this day — its
 * own and the workspace-wide ones — which the caller has already picked.
 */
export function openWindows(
  hours: readonly BookingWindow[],
  weekday: number,
  closures: readonly { startMinute: number | null; endMinute: number | null }[],
): BookingMinuteRange[] {
  let open: BookingMinuteRange[] = hours
    .filter((window) => window.weekday === weekday)
    .map((window) => ({ startMinute: window.startMinute, endMinute: window.endMinute }))
    .sort((a, b) => a.startMinute - b.startMinute);

  for (const closure of closures) {
    // A closure with no minutes is the whole day.
    const cut = { startMinute: closure.startMinute ?? 0, endMinute: closure.endMinute ?? MINUTES_PER_DAY };
    open = open.flatMap((window) => subtract(window, cut));
  }
  return open;
}

/** `window` with `cut` taken out: nothing, one piece, or the piece either side. */
function subtract(window: BookingMinuteRange, cut: BookingMinuteRange): BookingMinuteRange[] {
  if (cut.endMinute <= window.startMinute || cut.startMinute >= window.endMinute) return [window];
  const pieces: BookingMinuteRange[] = [];
  if (cut.startMinute > window.startMinute) {
    pieces.push({ startMinute: window.startMinute, endMinute: cut.startMinute });
  }
  if (cut.endMinute < window.endMinute) pieces.push({ startMinute: cut.endMinute, endMinute: window.endMinute });
  return pieces;
}

/**
 * Whether a booking of `durationMinutes` starting at `startMinute` sits wholly
 * inside ONE open stretch. Its buffers may fall outside: clearing up after the
 * last booking of the day is not opening time.
 */
export function fitsOpenWindows(
  startMinute: number,
  durationMinutes: number,
  windows: readonly BookingMinuteRange[],
): boolean {
  const endMinute = startMinute + durationMinutes;
  return windows.some((window) => startMinute >= window.startMinute && endMinute <= window.endMinute);
}
