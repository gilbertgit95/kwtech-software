import {
  BOOKING_CUSTOMER_NAME_MAX,
  BOOKING_NOTE_MAX,
  BOOKING_PHONE_MAX,
  BOOKING_REASON_MAX,
} from '../domain/appointments.js';
import {
  BOOKING_BUFFER_MAX_MINUTES,
  BOOKING_DURATION_MAX_MINUTES,
  BOOKING_DURATION_MIN_MINUTES,
  BOOKING_NAME_MAX,
  BOOKING_SERVICES_MAX,
} from '../domain/catalogue.js';
import { BOOKING_WINDOWS_PER_DAY_MAX } from '../domain/hours.js';
import { BOOKING_SLOT_TAKEN_MESSAGE } from '../domain/slots.js';
import type { BookingRefusal } from '../types.js';

/**
 * One error type for every refusal a booking operation makes.
 *
 * A REASON CODE, not a message: the transport decides the wording's fate, and a
 * caller that has to regex a sentence gets it wrong on the first rewording.
 *
 * ⚠ The app sees only the MESSAGE (`formatError` strips `extensions` in
 * production), so every message is a full sentence a person at the desk can act
 * on.
 */
export class BookingWriteError extends Error {
  constructor(
    readonly reason: BookingRefusal,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'BookingWriteError';
  }
}

/** The sentence for each refusal a domain check can return. */
export function refusalError(reason: BookingRefusal): BookingWriteError {
  return new BookingWriteError(reason, REFUSAL_MESSAGES[reason]);
}

/**
 * ⚠ ONE MESSAGE for a thing that does not exist and one in another workspace.
 * Any difference tells a prober which of the two it hit.
 */
export function bookingNotFound(): BookingWriteError {
  return refusalError('not_found');
}

const REFUSAL_MESSAGES: Record<BookingRefusal, string> = {
  not_signed_in: 'Not signed in',
  not_found: 'That is not here any more — it may have been removed',
  service_archived: 'That service is archived — restore it before booking it',
  resource_archived: 'That resource is archived — restore it before booking it',
  resource_cannot_perform: 'That resource does not perform this service',
  outside_hours: 'That time is outside the opening hours, or on a closed day',
  slot_taken: BOOKING_SLOT_TAKEN_MESSAGE,
  in_the_past: 'That time has already passed',
  wrong_status: 'That cannot be done to this booking any more — it has moved on',
  too_early: 'A booking cannot be marked a no-show before its time has come',
  too_soon: 'That time is too soon to book here — choose a later one, or contact us',
  too_far_ahead: 'That day is further ahead than bookings are taken — choose an earlier one',
  past_cutoff: 'It is too close to the time to change this here — please contact us',
  contact_required: 'Leave a phone number or an e-mail address, so we can reach you about your booking',
  too_many_requests: 'You already have requests waiting to be confirmed — we will be in touch about those first',
  public_closed: 'Bookings are not being taken on this page at the moment',
  invalid_title: 'Give the booking page a name of at most 80 characters, so customers know whose it is',
  limit_reached: 'You have reached the most resources your plan allows here',
  too_many_services: `A workspace can keep at most ${BOOKING_SERVICES_MAX} services, counting archived ones`,
  invalid_time: 'A booking needs a start time, on a whole minute',
  invalid_day: 'A day must be a real calendar day',
  invalid_name: `A name is needed, of at most ${BOOKING_NAME_MAX} characters, with no invisible formatting`,
  invalid_duration: `A service lasts between ${BOOKING_DURATION_MIN_MINUTES} minutes and ${BOOKING_DURATION_MAX_MINUTES / 60} hours`,
  invalid_buffer: `The time kept clear before or after can be at most ${BOOKING_BUFFER_MAX_MINUTES / 60} hours`,
  invalid_price: 'A price must be an amount of zero or more',
  invalid_kind: 'A resource is staff, a place or equipment',
  invalid_member: 'Only somebody who works the bookings in this workspace can be linked to a resource',
  invalid_resources: 'Somebody or something on that list is not a resource of this workspace',
  invalid_hours: `Opening hours must not overlap, with at most ${BOOKING_WINDOWS_PER_DAY_MAX} stretches a day, each ending after it starts`,
  invalid_exception: 'A closed day needs a real day, and a closed stretch must end after it starts',
  invalid_customer_name: `A booking needs the customer’s name, of at most ${BOOKING_CUSTOMER_NAME_MAX} characters`,
  invalid_phone: `That does not look like a phone number — digits, at most ${BOOKING_PHONE_MAX} characters`,
  invalid_email: 'That does not look like an e-mail address',
  invalid_note: `A note can be at most ${BOOKING_NOTE_MAX} characters`,
  invalid_reason: `Say why, in at most ${BOOKING_REASON_MAX} characters`,
  invalid_settings: 'Those settings are not ones on offer',
};

/**
 * Whether the database refused a row because it would DOUBLE-BOOK a resource:
 * Postgres' exclusion violation (SQLSTATE `23P01`) on
 * `booking_appointment_no_overlap`.
 *
 * Detected structurally — this package does not import `@prisma/client` — and
 * loosely on purpose. Prisma 7 with the pg adapter raises its own `P2039`
 * ("exclusion constraint failed"), seen against Postgres on 2026-10-05; an
 * older client or another driver passes the SQLSTATE through on the error, on
 * its `cause`, or only inside the message. Any of them is this refusal.
 */
export function isSlotConflict(error: unknown): boolean {
  let current: unknown = error;
  // Bounded: a `cause` chain is short, and a cyclic one must not hang a request.
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown; meta?: unknown };
    if (candidate.code === '23P01' || candidate.code === 'P2039') return true;
    const metaCode = (candidate.meta as { code?: unknown } | undefined)?.code;
    if (metaCode === '23P01') return true;
    if (typeof candidate.message === 'string' && /23P01|booking_appointment_no_overlap/u.test(candidate.message)) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/** Prisma's `P2002`, detected structurally. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
