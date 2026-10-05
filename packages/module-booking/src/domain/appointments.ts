import type { BookingRefusal, BookingStatus } from '../types.js';
import { prepareBookingBlock, prepareBookingLine } from './text.js';

/**
 * A booking's life (BOOKING-PLAN §2), and the customer's details on it.
 *
 *   pending ──▶ confirmed ──▶ arrived ──▶ done
 *      │            │            │
 *      ├▶ declined  ├▶ no_show   └▶ cancelled
 *      └▶ cancelled ├▶ done
 *                   └▶ cancelled
 *
 * ⚠ NOTHING COMES BACK from `declined`, `done`, `cancelled` or `no_show`, and
 * nothing is ever deleted (D7). Undoing one would have to take the slot again,
 * which is a new booking's check, not a status change: the desk makes a new
 * booking, and the old one stays in the history saying what happened.
 */

/** What staff do to a booking's status. Rescheduling is not one: it moves the time, not the status. */
export type BookingAct = 'confirm' | 'decline' | 'arrive' | 'finish' | 'no_show' | 'cancel';

/** In code points. */
export const BOOKING_CUSTOMER_NAME_MAX = 120;
export const BOOKING_PHONE_MAX = 40;
/** The longest address a mailbox can have (RFC 5321). */
export const BOOKING_EMAIL_MAX = 254;
export const BOOKING_NOTE_MAX = 2000;
export const BOOKING_REASON_MAX = 300;

/** The status an act leads to from `current`, or a refusal when it cannot be done from there. */
export function nextBookingStatus(
  current: BookingStatus,
  act: BookingAct,
): { status: BookingStatus } | { refused: BookingRefusal } {
  switch (act) {
    case 'confirm':
      return current === 'pending' ? { status: 'confirmed' } : { refused: 'wrong_status' };
    case 'decline':
      return current === 'pending' ? { status: 'declined' } : { refused: 'wrong_status' };
    case 'arrive':
      return current === 'confirmed' ? { status: 'arrived' } : { refused: 'wrong_status' };
    case 'finish':
      // From `confirmed` too: a desk that does not mark arrivals still finishes its bookings.
      return current === 'confirmed' || current === 'arrived' ? { status: 'done' } : { refused: 'wrong_status' };
    case 'no_show':
      return current === 'confirmed' ? { status: 'no_show' } : { refused: 'wrong_status' };
    case 'cancel':
      return current === 'pending' || current === 'confirmed' || current === 'arrived'
        ? { status: 'cancelled' }
        : { refused: 'wrong_status' };
  }
}

/** Whether `act` can be done from `status` — what a screen shows a button for. The API decides again. */
export function canBookingAct(status: BookingStatus, act: BookingAct): boolean {
  return 'status' in nextBookingStatus(status, act);
}

/**
 * Whether it is too soon for `act`. Only a no-show has a time: nobody has
 * failed to turn up for a booking that has not started. Arriving early, and
 * finishing early, are ordinary.
 */
export function checkBookingActTime(act: BookingAct, startsAt: Date, now: Date): BookingRefusal | null {
  return act === 'no_show' && now.getTime() < startsAt.getTime() ? 'too_early' : null;
}

/**
 * Whether a booking may still be moved. Only one that has not begun: a customer
 * who has arrived is being served, and one that is over is history.
 */
export function checkReschedule(status: BookingStatus): BookingRefusal | null {
  return status === 'pending' || status === 'confirmed' ? null : 'wrong_status';
}

/** Whether the customer's details and the note may still be corrected: until the booking is over. */
export function checkEditDetails(status: BookingStatus): BookingRefusal | null {
  return status === 'pending' || status === 'confirmed' || status === 'arrived' ? null : 'wrong_status';
}

export interface BookingCustomerInput {
  customerName: string;
  customerPhone?: string | null | undefined;
  customerEmail?: string | null | undefined;
  note?: string | null | undefined;
}

export interface PreparedBookingCustomer {
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  note: string;
}

/** Digits, with the punctuation people type around them. Not a format: a number is whatever reaches the customer. */
const PHONE = /^\+?[\d\s().-]+$/u;
/** One `@`, something either side, a dot in the domain. Whether it is deliverable only a message can tell. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/**
 * The customer's details as they are copied onto the booking (D5).
 *
 * ⚠ PHONE AND E-MAIL ARE SEPARATE FIELDS (D3), each optional. Messages to
 * customers come later and are addressed to one or the other, so "contact" as
 * one free-text line would have to be taken apart then — by guessing.
 */
export function prepareBookingCustomer(
  input: BookingCustomerInput,
): { customer: PreparedBookingCustomer } | { refused: BookingRefusal } {
  const customerName = prepareBookingLine(input.customerName, BOOKING_CUSTOMER_NAME_MAX);
  if (customerName === null) return { refused: 'invalid_customer_name' };

  const phone = prepareBookingLine(input.customerPhone ?? '', BOOKING_PHONE_MAX, { allowEmpty: true });
  if (phone === null || (phone !== '' && (!PHONE.test(phone) || !/\d/u.test(phone)))) {
    return { refused: 'invalid_phone' };
  }
  const email = prepareBookingLine(input.customerEmail ?? '', BOOKING_EMAIL_MAX, { allowEmpty: true });
  if (email === null || (email !== '' && !EMAIL.test(email))) return { refused: 'invalid_email' };

  const note = prepareBookingBlock(input.note ?? '', BOOKING_NOTE_MAX);
  if (note === null) return { refused: 'invalid_note' };

  return {
    customer: {
      customerName,
      customerPhone: phone === '' ? null : phone,
      // Lower-cased: the domain is case-insensitive, and nobody's mailbox is told apart by its capitals.
      customerEmail: email === '' ? null : email.toLowerCase(),
      note,
    },
  };
}

/**
 * Why a booking was cancelled or declined. ⚠ REQUIRED for a cancellation (D7):
 * "who cancelled Maria's booking, and why" has to have an answer.
 */
export function prepareBookingReason(
  raw: string | null | undefined,
  options: { required: boolean },
): { reason: string } | { refused: BookingRefusal } {
  const reason = prepareBookingLine(raw ?? '', BOOKING_REASON_MAX, { allowEmpty: !options.required });
  return reason === null ? { refused: 'invalid_reason' } : { reason };
}
