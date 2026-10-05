import type { BookingMinuteRange, BookingServiceTimes, BookingStatus } from '../types.js';
import { addMinutes, type BookingDay, zonedInstant } from './time.js';

/**
 * ⚠ NO DOUBLE BOOKING (BOOKING-PLAN §3) — the arithmetic behind it.
 *
 * A booking takes its resource for its BLOCKED RANGE: the service's time plus
 * the buffer before and after it. Two bookings of one resource clash when
 * their blocked ranges overlap, and only while each still HOLDS its slot.
 *
 * This file decides; three things enforce, and all three must agree with it:
 *
 *   - the write, which looks for a clash inside its transaction;
 *   - the database, whose exclusion constraint on `booking_appointment` refuses
 *     the row when two writes race past that look (principle 6);
 *   - the slot list, which offers only what the first two would accept.
 */

/**
 * The sentence somebody sees when the time they chose has just been taken.
 *
 * Here, in the pure root, because BOTH halves need the exact words: the server
 * says them, and the form compares against them — on this refusal, and only
 * this one, it reads the free times again. The app sees a refusal's message
 * and not its reason (`formatError` strips `extensions` in production), so the
 * sentence is the contract.
 */
export const BOOKING_SLOT_TAKEN_MESSAGE = 'That time has just been taken — choose another';

/** A stretch of time something takes, `[from, until)`. */
export interface BookingRange {
  from: Date;
  until: Date;
}

/**
 * The statuses in which a booking holds its slot.
 *
 * ⚠ `pending` HOLDS (D2). A request waiting for staff keeps its time: were it
 * left free, two customers could both be waiting on a confirmation only one
 * can get. Declining it is what frees the slot.
 *
 * `done` holds too — the time was used. `no_show` does not: nobody came, and
 * the desk may give that time to somebody standing there.
 *
 * ⚠ THE SAME LIST IS WRITTEN IN THE MIGRATION that adds the exclusion
 * constraint (`booking_appointment_no_overlap`). Changing one without the other
 * makes the database refuse what the app offers, or allow what it refuses.
 */
export const BOOKING_HOLDING_STATUSES = [
  'pending',
  'confirmed',
  'arrived',
  'done',
] as const satisfies readonly BookingStatus[];

export function holdsSlot(status: BookingStatus): boolean {
  return (BOOKING_HOLDING_STATUSES as readonly BookingStatus[]).includes(status);
}

/** When a booking starting at `startsAt` ends, and the whole stretch it takes its resource for. */
export function bookingTimes(
  startsAt: Date,
  service: BookingServiceTimes,
): { endsAt: Date; blockedFrom: Date; blockedUntil: Date } {
  const endsAt = addMinutes(startsAt, service.durationMinutes);
  return {
    endsAt,
    blockedFrom: addMinutes(startsAt, -service.bufferBeforeMinutes),
    blockedUntil: addMinutes(endsAt, service.bufferAfterMinutes),
  };
}

/** Whether two half-open stretches share any time. Touching ends do not clash. */
export function rangesOverlap(a: BookingRange, b: BookingRange): boolean {
  return a.from.getTime() < b.until.getTime() && b.from.getTime() < a.until.getTime();
}

export interface FreeSlotInput {
  day: BookingDay;
  timeZone: string;
  /** The resource's open stretches on `day` (`openWindows`). */
  windows: readonly BookingMinuteRange[];
  service: BookingServiceTimes;
  /** The blocked ranges of the bookings that already hold this resource. */
  busy: readonly BookingRange[];
  /** How far apart the offered starts are, in minutes. */
  slotMinutes: number;
  /** Starts at or before this are not offered: nobody books the past. */
  now: Date;
}

/**
 * The starts ONE resource can still take on one day, in order.
 *
 * Counted from each window's own opening (a shop opening at 9:15 offers 9:15,
 * 9:45…), and a start is offered only if the whole service fits inside that
 * window and its blocked range clashes with nothing.
 */
export function freeSlotStarts(input: FreeSlotInput): Date[] {
  const { service } = input;
  const starts: Date[] = [];
  if (input.slotMinutes <= 0 || service.durationMinutes <= 0) return starts;

  for (const window of input.windows) {
    for (
      let minute = window.startMinute;
      minute + service.durationMinutes <= window.endMinute;
      minute += input.slotMinutes
    ) {
      const startsAt = zonedInstant(input.day, minute, input.timeZone);
      if (!startsAt || startsAt.getTime() <= input.now.getTime()) continue;
      const { blockedFrom, blockedUntil } = bookingTimes(startsAt, service);
      const blocked = { from: blockedFrom, until: blockedUntil };
      if (!input.busy.some((taken) => rangesOverlap(blocked, taken))) starts.push(startsAt);
    }
  }
  return starts;
}
