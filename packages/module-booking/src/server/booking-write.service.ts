import { zonedMinuteOfDay } from '@kwtech/module-kit';
import { Inject, Injectable } from '@nestjs/common';
import {
  type BookingAct,
  type BookingCustomerInput,
  checkBookingActTime,
  checkEditDetails,
  checkReschedule,
  nextBookingStatus,
  prepareBookingCustomer,
  prepareBookingReason,
} from '../domain/appointments.js';
import { fitsOpenWindows } from '../domain/hours.js';
import { BOOKING_HOLDING_STATUSES, bookingTimes } from '../domain/slots.js';
import { parseBookingInstant, workspaceBookingDay } from '../domain/time.js';
import type { BookingChangeKind, BookingRefusal } from '../types.js';
import { BookingWriteError, isSlotConflict, refusalError } from './booking.errors.js';
import { BookingEventPublisher } from './booking.events.js';
import { type BookingScope, loadAppointment, loadResource, loadService, openWindowsOn } from './booking.lookup.js';
import type {
  BookingAppointmentRow,
  BookingResourceRow,
  BookingServiceRow,
  BookingTransaction,
  BookingWriteClient,
} from './booking.repository.js';
import { BOOKING_PRISMA_WRITE } from './booking.tokens.js';
import { BookingTimeZoneService } from './booking-time-zone.service.js';

export interface CreateBookingInput extends BookingCustomerInput {
  serviceId: string;
  resourceId: string;
  /** An ISO instant with its zone, on a whole minute. */
  startsAt: string;
}

/** The statuses staff may mark a booking with, once it is confirmed. */
export const BOOKING_MARKS = ['arrived', 'done', 'no_show'] as const;
export type BookingMark = (typeof BOOKING_MARKS)[number];

const MARK_ACT: Record<BookingMark, BookingAct> = { arrived: 'arrive', done: 'finish', no_show: 'no_show' };

/**
 * Who is behind a write. Staff are named; the customer has no account, so is
 * known only as "the customer" — proven by their manage token, which
 * `BookingPublicService` has already checked before it calls here; and the app
 * itself, when a request lapses.
 */
export type BookingActor = { kind: 'staff'; actorId: string } | { kind: 'customer' } | { kind: 'system' };

const staff = (actorId: string): BookingActor => ({ kind: 'staff', actorId });
const actorIdOf = (by: BookingActor): string | null => (by.kind === 'staff' ? by.actorId : null);

const ACT_CHANGE: Record<BookingAct, BookingChangeKind> = {
  confirm: 'confirmed',
  decline: 'declined',
  arrive: 'arrived',
  finish: 'done',
  no_show: 'no_show',
  cancel: 'cancelled',
};

/**
 * Every write to a booking: by staff, by the customer (through
 * `BookingPublicService`, which proves who they are and applies their rules),
 * and by the app when a request lapses.
 *
 * Each one: find the booking BY ID AND SCOPE, ask the domain whether it may be
 * done, write it and its history row in one transaction, then publish after
 * the commit.
 *
 * ## ⚠ NO DOUBLE BOOKING — the three places it is kept (BOOKING-PLAN §3)
 *
 * 1. `takeSlot` looks for a clash INSIDE the transaction, so the usual refusal
 *    is a sentence and not a database error.
 * 2. The database's exclusion constraint (`booking_appointment_no_overlap`)
 *    refuses the row when two writes both passed that look at the same moment.
 *    Read committed lets them: neither sees the other's uncommitted row.
 *    `isSlotConflict` turns that into the SAME refusal.
 * 3. A move is checked exactly like a new booking, in the transaction that
 *    frees the old time — so it can never double-book, and a refused move
 *    leaves the booking where it was.
 *
 * ## The app cannot tell the customer
 *
 * Nothing here reaches a customer (D3). When staff cancel or move a booking,
 * the screen says so, with the phone and e-mail in front of them.
 */
@Injectable()
export class BookingWriteService {
  constructor(
    @Inject(BOOKING_PRISMA_WRITE) private readonly prisma: BookingWriteClient,
    private readonly zones: BookingTimeZoneService,
    private readonly events: BookingEventPublisher,
  ) {}

  // ── making one ────────────────────────────────────────────────────────────

  /**
   * A booking made by staff, CONFIRMED AS IT IS MADE (D6): the person making it
   * is the one who would confirm it.
   *
   * ⚠ OPENING HOURS BIND STAFF TOO. A time outside them, or on a closed day, is
   * refused: the hours are the shop's own statement of when a resource can be
   * booked, and a booking outside them is one the slot list would never have
   * offered. Whoever means to open late changes the hours.
   */
  async create(scope: BookingScope, actorId: string, input: CreateBookingInput): Promise<BookingAppointmentRow> {
    return this.make(scope, input, staff(actorId), { status: 'confirmed', manageTokenHash: null });
  }

  /**
   * A booking ASKED FOR on the public page (D2): `pending`, holding its slot,
   * until staff confirm or decline it. The customer's rules — notice, horizon,
   * how many requests one contact may have waiting — are the caller's check
   * (`BookingPublicService`); everything a booking by staff must satisfy is
   * checked here exactly as for staff.
   *
   * @param manageTokenHash the hash of the token handed to the customer.
   */
  async request(
    scope: BookingScope,
    input: CreateBookingInput,
    manageTokenHash: string,
  ): Promise<BookingAppointmentRow> {
    return this.make(scope, input, { kind: 'customer' }, { status: 'pending', manageTokenHash });
  }

  private async make(
    scope: BookingScope,
    input: CreateBookingInput,
    by: BookingActor,
    as: { status: 'confirmed' | 'pending'; manageTokenHash: string | null },
  ): Promise<BookingAppointmentRow> {
    const { customer } = unwrap(prepareBookingCustomer(input));
    const now = new Date();
    const startsAt = this.readStart(input.startsAt, now);

    const [service, resource] = await Promise.all([
      loadService(this.prisma, scope, input.serviceId),
      loadResource(this.prisma, scope, input.resourceId),
    ]);
    if (service.archivedAt !== null) throw refusalError('service_archived');
    await this.requireBookable(scope, service, resource, startsAt);
    const times = bookingTimes(startsAt, service);

    const appointment = await this.guardSlot(() =>
      this.prisma.$transaction(async (tx) => {
        await takeSlot(tx, scope, resource.id, times, null);
        const created = await tx.bookingAppointment.create({
          data: {
            ...scope,
            serviceId: service.id,
            resourceId: resource.id,
            startsAt,
            ...times,
            status: as.status,
            ...customer,
            createdById: actorIdOf(by),
            pendingSince: as.status === 'pending' ? now : null,
            manageTokenHash: as.manageTokenHash,
          },
        });
        await tx.bookingChange.create({
          data: {
            ...scope,
            appointmentId: created.id,
            kind: 'created',
            actorKind: by.kind,
            actorId: actorIdOf(by),
            toStartsAt: startsAt,
            toResourceId: resource.id,
          },
        });
        return created;
      }),
    );

    await this.events.changed(scope, 'appointment', actorIdOf(by), appointment.id);
    return appointment;
  }

  // ── moving one ────────────────────────────────────────────────────────────

  /**
   * Moves a booking to another time, another resource, or both. ⚠ THE SAME
   * BOOKING, not a cancellation and a new one (D7): its history stays in one
   * place, with where it moved from.
   *
   * By staff, its status does not change: a confirmed booking stays confirmed
   * (D6). Its blocked range is worked out again from the service as it is NOW.
   */
  async reschedule(
    scope: BookingScope,
    actorId: string,
    appointmentId: string,
    startsAtRaw: string,
    resourceId: string,
  ): Promise<BookingAppointmentRow> {
    const appointment = await loadAppointment(this.prisma, scope, appointmentId);
    return this.move(appointment, startsAtRaw, resourceId, staff(actorId));
  }

  /**
   * The CUSTOMER moves their own booking, on their manage link. ⚠ IT NEEDS
   * CONFIRMING AGAIN (D8): the booking goes back to `pending` at the new time,
   * holding the new slot and freeing the old one — a time the customer picked
   * is a request until staff accept it. The cost, accepted and said on the
   * page before the move: if staff decline, the old time is gone too.
   *
   * `appointment` was found by its manage token; the cutoff and the customer's
   * other rules are the caller's check.
   */
  async rescheduleByCustomer(
    appointment: BookingAppointmentRow,
    startsAtRaw: string,
    resourceId: string,
  ): Promise<BookingAppointmentRow> {
    return this.move(appointment, startsAtRaw, resourceId, { kind: 'customer' });
  }

  private async move(
    appointment: BookingAppointmentRow,
    startsAtRaw: string,
    resourceId: string,
    by: BookingActor,
  ): Promise<BookingAppointmentRow> {
    const scope: BookingScope = { organizationId: appointment.organizationId, workspaceId: appointment.workspaceId };
    const now = new Date();
    const startsAt = this.readStart(startsAtRaw, now);
    refuse(checkReschedule(appointment.status));
    // Nothing to move: no history row for a move that did not happen.
    if (appointment.startsAt.getTime() === startsAt.getTime() && appointment.resourceId === resourceId) {
      return appointment;
    }

    const [service, resource] = await Promise.all([
      // Archived or not: the booking exists, and moving it is not offering the service anew.
      loadService(this.prisma, scope, appointment.serviceId),
      loadResource(this.prisma, scope, resourceId),
    ]);
    await this.requireBookable(scope, service, resource, startsAt);
    const times = bookingTimes(startsAt, service);

    await this.guardSlot(() =>
      this.prisma.$transaction(async (tx) => {
        // ⚠ Its own row is left out of the look: a booking does not clash with itself.
        await takeSlot(tx, scope, resource.id, times, appointment.id);
        const moved = await tx.bookingAppointment.updateMany({
          where: { ...scope, id: appointment.id, status: appointment.status },
          data: {
            resourceId: resource.id,
            startsAt,
            ...times,
            // By the customer: back to waiting for staff, from now, with the old decision cleared.
            ...(by.kind === 'customer'
              ? { status: 'pending' as const, pendingSince: now, decidedById: null, decidedAt: null }
              : {}),
          },
        });
        // Somebody cancelled or marked it while this was being decided.
        if (moved.count === 0) throw refusalError('wrong_status');
        await tx.bookingChange.create({
          data: {
            ...scope,
            appointmentId: appointment.id,
            kind: 'rescheduled',
            actorKind: by.kind,
            actorId: actorIdOf(by),
            fromStartsAt: appointment.startsAt,
            toStartsAt: startsAt,
            fromResourceId: appointment.resourceId,
            toResourceId: resource.id,
          },
        });
      }),
    );

    await this.events.changed(scope, 'appointment', actorIdOf(by), appointment.id);
    return loadAppointment(this.prisma, scope, appointment.id);
  }

  // ── correcting one ────────────────────────────────────────────────────────

  /** The customer's name, phone, e-mail and the note — until the booking is over. */
  async updateDetails(
    scope: BookingScope,
    actorId: string,
    appointmentId: string,
    input: BookingCustomerInput,
  ): Promise<BookingAppointmentRow> {
    const { customer } = unwrap(prepareBookingCustomer(input));
    const appointment = await loadAppointment(this.prisma, scope, appointmentId);
    refuse(checkEditDetails(appointment.status));

    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.bookingAppointment.updateMany({
        where: { ...scope, id: appointment.id, status: appointment.status },
        data: customer,
      });
      if (changed.count === 0) throw refusalError('wrong_status');
      await tx.bookingChange.create({
        data: { ...scope, appointmentId: appointment.id, kind: 'details', actorKind: 'staff', actorId },
      });
    });

    await this.events.changed(scope, 'appointment', actorId, appointment.id);
    return loadAppointment(this.prisma, scope, appointment.id);
  }

  // ── its status ────────────────────────────────────────────────────────────

  /** Staff accept a request made on the public link (D2). */
  async confirm(scope: BookingScope, actorId: string, appointmentId: string): Promise<BookingAppointmentRow> {
    return this.act(await loadAppointment(this.prisma, scope, appointmentId), 'confirm', '', staff(actorId));
  }

  /** Staff refuse a request — which frees its slot. The reason is optional. */
  async decline(
    scope: BookingScope,
    actorId: string,
    appointmentId: string,
    reason: string | null | undefined,
  ): Promise<BookingAppointmentRow> {
    const prepared = unwrap(prepareBookingReason(reason, { required: false }));
    return this.act(
      await loadAppointment(this.prisma, scope, appointmentId),
      'decline',
      prepared.reason,
      staff(actorId),
    );
  }

  /** Marks a confirmed booking `arrived`, `done` or `no_show`. */
  async mark(
    scope: BookingScope,
    actorId: string,
    appointmentId: string,
    status: string,
  ): Promise<BookingAppointmentRow> {
    if (!(BOOKING_MARKS as readonly string[]).includes(status)) throw refusalError('wrong_status');
    // Narrowed by the line above: `status` is one of the three marks.
    const act = MARK_ACT[status as BookingMark];
    return this.act(await loadAppointment(this.prisma, scope, appointmentId), act, '', staff(actorId));
  }

  /**
   * Cancels a booking — kept, with who cancelled it, when and WHY (D7). The
   * reason is required. Guarded by its own key, `booking:cancel_appointments`.
   */
  async cancel(
    scope: BookingScope,
    actorId: string,
    appointmentId: string,
    reason: string | null | undefined,
  ): Promise<BookingAppointmentRow> {
    const prepared = unwrap(prepareBookingReason(reason, { required: true }));
    return this.act(
      await loadAppointment(this.prisma, scope, appointmentId),
      'cancel',
      prepared.reason,
      staff(actorId),
    );
  }

  /**
   * The CUSTOMER cancels their own booking, on their manage link. The reason is
   * optional for them: the desk must account for a cancellation, a customer
   * need not. `appointment` was found by its manage token, and the cutoff is
   * the caller's check.
   */
  async cancelByCustomer(
    appointment: BookingAppointmentRow,
    reason: string | null | undefined,
  ): Promise<BookingAppointmentRow> {
    const prepared = unwrap(prepareBookingReason(reason, { required: false }));
    return this.act(appointment, 'cancel', prepared.reason, { kind: 'customer' });
  }

  /**
   * A request nobody confirmed in time is DECLINED BY THE APP, which frees its
   * slot (`booking.lapse_requests`). False when it was no longer pending —
   * somebody confirmed, declined or cancelled it first, which is not an error.
   */
  async lapse(appointment: BookingAppointmentRow, reason: string): Promise<boolean> {
    try {
      await this.act(appointment, 'decline', reason, { kind: 'system' });
      return true;
    } catch (error) {
      if (error instanceof BookingWriteError && error.reason === 'wrong_status') return false;
      throw error;
    }
  }

  private async act(
    appointment: BookingAppointmentRow,
    act: BookingAct,
    reason: string,
    by: BookingActor,
  ): Promise<BookingAppointmentRow> {
    const scope: BookingScope = { organizationId: appointment.organizationId, workspaceId: appointment.workspaceId };
    const now = new Date();
    const { status } = unwrap(nextBookingStatus(appointment.status, act));
    refuse(checkBookingActTime(act, appointment.startsAt, now));
    const decided = act === 'confirm' || act === 'decline';

    await this.prisma.$transaction(async (tx) => {
      // ⚠ Compare-and-set on the status the decision was made against.
      const changed = await tx.bookingAppointment.updateMany({
        where: { ...scope, id: appointment.id, status: appointment.status },
        data: {
          status,
          ...(decided ? { decidedById: actorIdOf(by), decidedAt: now } : {}),
          // It has stopped waiting, whichever way it went.
          ...(appointment.status === 'pending' ? { pendingSince: null } : {}),
        },
      });
      if (changed.count === 0) throw refusalError('wrong_status');
      await tx.bookingChange.create({
        data: {
          ...scope,
          appointmentId: appointment.id,
          kind: ACT_CHANGE[act],
          actorKind: by.kind,
          actorId: actorIdOf(by),
          reason,
        },
      });
    });

    await this.events.changed(scope, 'appointment', actorIdOf(by), appointment.id);
    return loadAppointment(this.prisma, scope, appointment.id);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** A start as it arrives: a real instant on a whole minute, and not already gone. */
  private readStart(raw: string, now: Date): Date {
    const startsAt = parseBookingInstant(raw);
    if (!startsAt) throw refusalError('invalid_time');
    if (startsAt.getTime() <= now.getTime()) throw refusalError('in_the_past');
    return startsAt;
  }

  /**
   * Whether this resource can take this service at this time at all — before
   * anybody asks whether the time is free: it is live, it performs the service,
   * and it is open then, in the WORKSPACE's day and hours.
   */
  private async requireBookable(
    scope: BookingScope,
    service: BookingServiceRow,
    resource: BookingResourceRow,
    startsAt: Date,
  ): Promise<void> {
    if (resource.archivedAt !== null) throw refusalError('resource_archived');
    const links = await this.prisma.bookingServiceResource.findMany({
      where: { serviceId: service.id, resourceId: resource.id },
    });
    if (links.length === 0) throw refusalError('resource_cannot_perform');

    const timeZone = await this.zones.of(scope);
    const day = workspaceBookingDay(startsAt, timeZone);
    const windows = await openWindowsOn(this.prisma, scope, [resource.id], day);
    const open = windows.get(resource.id) ?? [];
    if (!fitsOpenWindows(zonedMinuteOfDay(startsAt, timeZone), service.durationMinutes, open)) {
      throw refusalError('outside_hours');
    }
  }

  /** Runs a write that takes a slot, answering the database's own refusal as the domain's. */
  private async guardSlot<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      // ⚠ Two writes raced past `takeSlot`; the constraint let one through. Same refusal, same sentence.
      if (isSlotConflict(error)) throw refusalError('slot_taken');
      throw error;
    }
  }
}

/**
 * Refuses when another booking that HOLDS this resource shares any of the
 * blocked range. Inside the caller's transaction.
 *
 * `exceptId` is the booking being moved, left out of the look.
 */
async function takeSlot(
  tx: BookingTransaction,
  scope: BookingScope,
  resourceId: string,
  times: { blockedFrom: Date; blockedUntil: Date },
  exceptId: string | null,
): Promise<void> {
  const clashes = await tx.bookingAppointment.findMany({
    where: {
      ...scope,
      resourceId,
      status: { in: [...BOOKING_HOLDING_STATUSES] },
      blockedFrom: { lt: times.blockedUntil },
      blockedUntil: { gt: times.blockedFrom },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    take: 1,
  });
  if (clashes.length > 0) throw refusalError('slot_taken');
}

function refuse(refusal: BookingRefusal | null): void {
  if (refusal) throw refusalError(refusal);
}

function unwrap<T extends object>(result: T | { refused: BookingRefusal }): T {
  if ('refused' in result) throw refusalError(result.refused);
  return result;
}
