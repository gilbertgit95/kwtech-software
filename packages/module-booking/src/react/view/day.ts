import { type BookingAct, canBookingAct, checkEditDetails, checkReschedule } from '../../domain/appointments.js';
import type { BookingChangeKind, BookingResourceKind, BookingStatus } from '../../types.js';

/**
 * What the day list says about a booking, and what it offers to do with one.
 * Pure, and built on the domain's own rules — so a button is shown exactly
 * when the server would accept the press.
 */

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const STATUS_CHIPS: Readonly<Record<BookingStatus, { label: string; tone: StatusTone }>> = {
  // Warning: a request is the one thing on the list waiting for somebody at the desk.
  pending: { label: 'Waiting to be confirmed', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'info' },
  declined: { label: 'Declined', tone: 'neutral' },
  arrived: { label: 'Arrived', tone: 'success' },
  done: { label: 'Done', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  no_show: { label: 'No-show', tone: 'danger' },
};

/** A status as it crossed the wire, narrowed — or null for one this build does not know. */
export function asBookingStatus(status: string): BookingStatus | null {
  return status in STATUS_CHIPS ? (status as BookingStatus) : null;
}

/** The chip for a status. An unknown one is shown as it came, never hidden. */
export function statusChip(status: string): { label: string; tone: StatusTone } {
  const known = asBookingStatus(status);
  return known ? STATUS_CHIPS[known] : { label: status, tone: 'neutral' };
}

/** Whether the booking is over or off: drawn quietly, so the day's live bookings stand out. */
export function isSettled(status: string): boolean {
  return status === 'done' || status === 'cancelled' || status === 'declined' || status === 'no_show';
}

/** What somebody may do to a booking. Each key is one the API checks again. */
export interface BookingAbilities {
  /** `booking:manage_appointments`. */
  manage: boolean;
  /** `booking:cancel_appointments`. */
  cancel: boolean;
}

export interface BookingActions {
  confirm: boolean;
  decline: boolean;
  arrive: boolean;
  finish: boolean;
  noShow: boolean;
  reschedule: boolean;
  editDetails: boolean;
  cancel: boolean;
}

const NO_ACTIONS: BookingActions = {
  confirm: false,
  decline: false,
  arrive: false,
  finish: false,
  noShow: false,
  reschedule: false,
  editDetails: false,
  cancel: false,
};

/**
 * The buttons a booking shows: what its status allows (`nextBookingStatus`),
 * what the viewer holds, and — for a no-show — whether its time has come.
 */
export function bookingActions(
  booking: { status: string; startsAt: string },
  abilities: BookingAbilities,
  now: Date,
): BookingActions {
  const status = asBookingStatus(booking.status);
  if (!status) return NO_ACTIONS;
  const may = (act: BookingAct) => abilities.manage && canBookingAct(status, act);
  return {
    confirm: may('confirm'),
    decline: may('decline'),
    arrive: may('arrive'),
    finish: may('finish'),
    noShow: may('no_show') && new Date(booking.startsAt).getTime() <= now.getTime(),
    reschedule: abilities.manage && checkReschedule(status) === null,
    editDetails: abilities.manage && checkEditDetails(status) === null,
    cancel: abilities.cancel && canBookingAct(status, 'cancel'),
  };
}

/** The day at a glance: how many bookings still hold a time, and how many wait for the desk. */
export function daySummary(bookings: readonly { status: string }[]): { live: number; waiting: number } {
  let live = 0;
  let waiting = 0;
  for (const booking of bookings) {
    if (!isSettled(booking.status)) live += 1;
    if (booking.status === 'pending') waiting += 1;
  }
  return { live, waiting };
}

const CHANGE_TEXT: Readonly<Record<BookingChangeKind, string>> = {
  created: 'Booked',
  confirmed: 'Confirmed',
  declined: 'Declined',
  rescheduled: 'Moved',
  cancelled: 'Cancelled',
  arrived: 'Marked arrived',
  done: 'Marked done',
  no_show: 'Marked a no-show',
  details: 'Details corrected',
};

/** One line of a booking's history: what was done. An unknown kind is shown as it came. */
export function changeText(kind: string): string {
  return kind in CHANGE_TEXT ? CHANGE_TEXT[kind as BookingChangeKind] : kind;
}

/** Who did it: a named member, "a former member", or the customer on their link. */
export function changeActor(change: { actorKind: string; actorName: string | null }): string {
  if (change.actorKind === 'customer') return 'the customer';
  // A request nobody confirmed in time: declined by the app itself.
  if (change.actorKind === 'system') return 'the app';
  return change.actorName ?? 'a former member';
}

const KIND_LABELS: Readonly<Record<BookingResourceKind, string>> = {
  staff: 'Staff',
  place: 'Place',
  equipment: 'Equipment',
};

export const RESOURCE_KIND_OPTIONS: readonly { value: BookingResourceKind; label: string; hint: string }[] = [
  { value: 'staff', label: KIND_LABELS.staff, hint: 'A person who is booked.' },
  { value: 'place', label: KIND_LABELS.place, hint: 'A counter, a chair, a room.' },
  { value: 'equipment', label: KIND_LABELS.equipment, hint: 'A printer, a machine.' },
];

export function resourceKindLabel(kind: string): string {
  return kind in KIND_LABELS ? KIND_LABELS[kind as BookingResourceKind] : kind;
}

/** Up to two initials for a customer's badge: "Maria Santos" → "MS", "Cher" → "C". Never empty. */
export function customerInitials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const letters = [words[0], words.length > 1 ? words.at(-1) : undefined]
    .map((word) => (word ? [...word][0] : undefined))
    .filter((letter): letter is string => letter !== undefined);
  return letters.length === 0 ? '?' : letters.join('').toUpperCase();
}

/** The day in four numbers, for the tiles above the list. */
export interface DayStats {
  /** Still to come: confirmed, not yet arrived. */
  upcoming: number;
  /** Asked for on the public link and waiting for the desk. */
  waiting: number;
  /** Here now. */
  arrived: number;
  done: number;
}

export function dayStats(bookings: readonly { status: string }[]): DayStats {
  const stats: DayStats = { upcoming: 0, waiting: 0, arrived: 0, done: 0 };
  for (const booking of bookings) {
    if (booking.status === 'confirmed') stats.upcoming += 1;
    if (booking.status === 'pending') stats.waiting += 1;
    if (booking.status === 'arrived') stats.arrived += 1;
    if (booking.status === 'done') stats.done += 1;
  }
  return stats;
}
