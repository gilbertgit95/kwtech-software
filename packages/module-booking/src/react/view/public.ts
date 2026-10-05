import { DEFAULT_TIME_ZONE, isValidTimeZone } from '@kwtech/module-kit';
import { addBookingDays, type BookingDay } from '../../domain/time.js';
import type { StatusTone } from './day.js';
import { durationText } from './time.js';

/**
 * What a CUSTOMER reads on the public page and their manage link. Pure, and in
 * the customer's words: they do not "hold a slot while pending" — they are
 * waiting to hear.
 */

/**
 * The zone to print in, from the server's answer. ⚠ CHECKED before use: an
 * unknown zone makes `Intl` throw, and a visitor has no workspace provider to
 * fall back on. Unknown falls to the default, never to the visitor's own.
 */
export function publicTimeZone(timeZone: string | null | undefined): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
}

export interface CustomerStatus {
  label: string;
  tone: StatusTone;
  /** What it means for them, and what happens next. */
  explain: string;
}

/**
 * A booking's status as its customer is told it.
 *
 * ⚠ A REQUEST IS NEVER CALLED A BOOKING HERE (D2): "We will confirm your
 * booking", not "You are booked". Until staff confirm, the customer has asked
 * and nothing more.
 */
export function customerStatus(status: string, reason: string): CustomerStatus {
  const because = reason ? ` ${reason}.` : '';
  switch (status) {
    case 'pending':
      return {
        label: 'Waiting to be confirmed',
        tone: 'warning',
        explain:
          'Your request has been received and the time is being held for you. We will confirm it — check back on this page.',
      };
    case 'confirmed':
      return { label: 'Confirmed', tone: 'success', explain: 'You are booked. See you then.' };
    case 'declined':
      return {
        label: 'Not confirmed',
        tone: 'danger',
        explain: `We could not take this booking.${because} You are welcome to ask for another time.`,
      };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'neutral', explain: `This booking was cancelled.${because}` };
    case 'arrived':
      return { label: 'You are here', tone: 'success', explain: 'You have been checked in.' };
    case 'done':
      return { label: 'Completed', tone: 'neutral', explain: 'Thank you for coming.' };
    case 'no_show':
      return { label: 'Missed', tone: 'danger', explain: 'This booking was marked as missed.' };
    default:
      return { label: status, tone: 'neutral', explain: '' };
  }
}

/** How long before a booking the customer may still change it themselves, as words: "2 hr", "1 day". */
export function cutoffText(cutoffMinutes: number): string {
  if (cutoffMinutes === 0) return 'until it starts';
  if (cutoffMinutes % 1440 === 0) {
    const days = cutoffMinutes / 1440;
    return `up to ${days} ${days === 1 ? 'day' : 'days'} before`;
  }
  return `up to ${durationText(cutoffMinutes)} before`;
}

/** How many days the page offers as chips before the visitor has to use the date field. */
export const PUBLIC_DAY_CHIPS = 14;

/** The days a customer may book, from today, as far as the horizon — at most `PUBLIC_DAY_CHIPS` of them. */
export function bookableDays(today: BookingDay, lastDay: BookingDay): BookingDay[] {
  const days: BookingDay[] = [];
  for (let offset = 0; offset < PUBLIC_DAY_CHIPS; offset += 1) {
    const day = addBookingDays(today, offset);
    // Days compare as strings because `YYYY-MM-DD` sorts as dates.
    if (day > lastDay) break;
    days.push(day);
  }
  return days;
}
