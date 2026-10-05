/**
 * The shapes the domain decides over. Plain data, no framework, so the server
 * half and the web half hold the same rules.
 */

/**
 * What is booked (BOOKING-PLAN §2): a person, a place (a counter, a chair, a
 * room) or a piece of equipment (a printer, a machine).
 *
 * ⚠ GENERIC ON PURPOSE (D1). No trade is named here or anywhere in the schema:
 * what a shop calls its resources is data it enters.
 */
export type BookingResourceKind = 'staff' | 'place' | 'equipment';

/**
 * Where a booking stands.
 *
 *   pending   — asked for on the public link, waiting for staff (D2)
 *   confirmed — agreed. A booking made by staff starts here (D6)
 *   declined  — staff said no to a pending one
 *   arrived   — the customer is here
 *   done      — finished
 *   cancelled — called off, by staff or by the customer, with a reason (D7)
 *   no_show   — the time came and the customer did not
 *
 * ⚠ `pending` and `declined` are reached only from the public link: a booking
 * made by staff is confirmed as it is made. A pending booking HOLDS ITS SLOT.
 */
export type BookingStatus = 'pending' | 'confirmed' | 'declined' | 'arrived' | 'done' | 'cancelled' | 'no_show';

/** One entry of a booking's history (D7): what was done to it. */
export type BookingChangeKind =
  | 'created'
  | 'confirmed'
  | 'declined'
  | 'rescheduled'
  | 'cancelled'
  | 'arrived'
  | 'done'
  | 'no_show'
  | 'details';

/**
 * Who did it: a member of staff, the customer on the public page or their
 * manage link, or the app itself — a request nobody confirmed in time lapses
 * with nobody behind it.
 */
export type BookingChangeActor = 'staff' | 'customer' | 'system';

/** One stretch of a resource's week: minutes of the WORKSPACE's day, `[startMinute, endMinute)`. */
export interface BookingWindow {
  /** 0 is Sunday, as `Date#getDay` numbers them. */
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/** A stretch of one day, in minutes of the workspace's day, `[startMinute, endMinute)`. */
export interface BookingMinuteRange {
  startMinute: number;
  endMinute: number;
}

/** What the slot arithmetic needs to know about a service, and no more. */
export interface BookingServiceTimes {
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}

/**
 * Why a booking operation was refused. One union for the module, carried by
 * its one error class at the service boundary.
 *
 * ⚠ `not_found` ALSO MEANS "in another workspace". Answering those differently
 * would let anyone probe ids across tenants.
 */
export type BookingRefusal =
  | 'not_signed_in'
  | 'not_found'
  | 'service_archived'
  | 'resource_archived'
  | 'resource_cannot_perform'
  | 'outside_hours'
  | 'slot_taken'
  | 'in_the_past'
  | 'wrong_status'
  | 'too_early'
  | 'too_soon'
  | 'too_far_ahead'
  | 'past_cutoff'
  | 'contact_required'
  | 'too_many_requests'
  | 'public_closed'
  | 'invalid_title'
  | 'limit_reached'
  | 'too_many_services'
  | 'invalid_time'
  | 'invalid_day'
  | 'invalid_name'
  | 'invalid_duration'
  | 'invalid_buffer'
  | 'invalid_price'
  | 'invalid_kind'
  | 'invalid_member'
  | 'invalid_resources'
  | 'invalid_hours'
  | 'invalid_exception'
  | 'invalid_customer_name'
  | 'invalid_phone'
  | 'invalid_email'
  | 'invalid_note'
  | 'invalid_reason'
  | 'invalid_settings';
