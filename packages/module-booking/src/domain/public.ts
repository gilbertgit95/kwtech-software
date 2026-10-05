import type { BookingRefusal, BookingStatus } from '../types.js';
import { addBookingDays, addMinutes, type BookingDay } from './time.js';

/**
 * The rules that bind a CUSTOMER on the public booking page and their manage
 * link (BOOKING-PLAN §6). None of them binds staff: the desk books for
 * tomorrow morning at closing time, and cancels five minutes before, because
 * it is the desk that would have said no.
 *
 * ⚠ A BOOKING MADE BY A CUSTOMER IS A REQUEST (D2). It is `pending` until
 * staff confirm it, and it holds its slot while it waits.
 */

/** What a workspace has decided about its public page. */
export interface BookingPublicRules {
  /** Minutes. The least notice a customer must give: no booking for ten minutes from now. */
  leadMinutes: number;
  /** Days. How far ahead a customer may book, counting today as day 0. */
  horizonDays: number;
  /** Minutes before the start after which the customer can no longer cancel or move it themselves. */
  cutoffMinutes: number;
}

/** How many requests one phone number or e-mail address may have waiting in a workspace at once. */
export const BOOKING_REQUESTS_PER_CONTACT_MAX = 3;

/**
 * How many requests a workspace may have waiting at once, from everybody. The
 * page takes no sign-in, so this is the bound on what one visitor with many
 * made-up contacts can hold: past it, the page says to contact the shop.
 */
export const BOOKING_REQUESTS_PER_WORKSPACE_MAX = 200;

/** The earliest start a customer may ask for: the run's clock plus the notice the workspace wants. */
export function earliestPublicStart(now: Date, rules: Pick<BookingPublicRules, 'leadMinutes'>): Date {
  return addMinutes(now, rules.leadMinutes);
}

/** The last WORKSPACE day a customer may book on, given the workspace's today. */
export function lastPublicDay(today: BookingDay, rules: Pick<BookingPublicRules, 'horizonDays'>): BookingDay {
  return addBookingDays(today, rules.horizonDays);
}

/**
 * Whether a customer may ask for this start: not sooner than the notice, and
 * not on a day past the horizon. Days compare as strings because `YYYY-MM-DD`
 * sorts as dates; `startDay` and `today` are both the WORKSPACE's.
 */
export function checkPublicStart(
  start: { startsAt: Date; startDay: BookingDay },
  clock: { now: Date; today: BookingDay },
  rules: BookingPublicRules,
): BookingRefusal | null {
  if (start.startsAt.getTime() < earliestPublicStart(clock.now, rules).getTime()) return 'too_soon';
  if (start.startDay > lastPublicDay(clock.today, rules)) return 'too_far_ahead';
  return null;
}

/**
 * Whether the customer may still cancel or move their booking themselves.
 *
 *   - only one that has not begun and is not over: `pending` or `confirmed`;
 *   - and only until the cutoff before its start. Past it the page says to
 *     contact the shop — the desk can still do either.
 */
export function checkCustomerChange(
  booking: { status: BookingStatus; startsAt: Date },
  now: Date,
  rules: Pick<BookingPublicRules, 'cutoffMinutes'>,
): BookingRefusal | null {
  if (booking.status !== 'pending' && booking.status !== 'confirmed') return 'wrong_status';
  return now.getTime() > addMinutes(booking.startsAt, -rules.cutoffMinutes).getTime() ? 'past_cutoff' : null;
}

/**
 * When a request nobody confirmed lapses: `lapseHours` after it began waiting,
 * or at its own start time, whichever comes first. A request still unanswered
 * when its time arrives is not a booking.
 */
export function requestLapsesAt(request: { pendingSince: Date; startsAt: Date }, lapseHours: number): Date {
  const byWaiting = addMinutes(request.pendingSince, lapseHours * 60);
  return byWaiting.getTime() < request.startsAt.getTime() ? byWaiting : request.startsAt;
}

/** The sentence kept on a lapsed request, and shown to the customer on their manage link. */
export const BOOKING_LAPSED_REASON = 'Not confirmed in time';
