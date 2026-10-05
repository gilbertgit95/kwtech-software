import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type BookingCustomerInput, prepareBookingCustomer } from '../domain/appointments.js';
import type { BookingSettingsValues } from '../domain/catalogue.js';
import {
  BOOKING_REQUESTS_PER_CONTACT_MAX,
  BOOKING_REQUESTS_PER_WORKSPACE_MAX,
  checkCustomerChange,
  checkPublicStart,
  earliestPublicStart,
  lastPublicDay,
} from '../domain/public.js';
import { parseBookingInstant, prepareBookingDay, workspaceBookingDay } from '../domain/time.js';
import type { BookingRefusal } from '../types.js';
import { BookingWriteError, refusalError } from './booking.errors.js';
import type { BookingScope } from './booking.lookup.js';
import type {
  BookingAppointmentRow,
  BookingChangeRow,
  BookingPrismaClient,
  BookingServiceRow,
} from './booking.repository.js';
import { BookingReadService, type BookingResourceSlots } from './booking.service.js';
import { BOOKING_MEMBER_DIRECTORY, BOOKING_NOTIFIER, BOOKING_PRISMA } from './booking.tokens.js';
import { hashManageToken, newManageToken } from './booking-secrets.js';
import { BookingTimeZoneService } from './booking-time-zone.service.js';
import { BookingWriteService } from './booking-write.service.js';
import type { BookingCustomerNotice, BookingMemberDirectory, BookingNotifier } from './ports.js';

/** How many services the public page lists. */
const PUBLIC_SERVICES_MAX = 200;

/** What a visitor is shown of a workspace: only what the shop wrote for them, and what can be booked. */
export interface BookingPublicPage {
  title: string;
  note: string;
  /** The workspace's zone: every time on the page is printed in it. */
  timeZone: string;
  /** The workspace's today, and the last day a customer may book on. */
  today: string;
  lastDay: string;
  /** Minutes before its start until which a customer may still cancel or move a booking. */
  cutoffMinutes: number;
  /** The live services somebody can perform. */
  services: readonly BookingServiceRow[];
}

/** A resource's free times as a visitor sees them: its name, never anything about who holds the rest. */
export interface BookingPublicSlots extends BookingResourceSlots {
  resourceName: string;
}

/** One booking as its customer sees it on their manage link. */
export interface BookingPublicView {
  page: Pick<BookingPublicPage, 'title' | 'note' | 'timeZone' | 'today' | 'lastDay' | 'cutoffMinutes'>;
  appointment: BookingAppointmentRow;
  serviceName: string;
  resourceName: string;
  /** Why it was declined or cancelled, when somebody said. */
  reason: string;
  /** Whether the customer may still cancel or move it themselves; false past the cutoff, and once it is over. */
  canChange: boolean;
}

interface OpenLink {
  scope: BookingScope;
  settings: BookingSettingsValues;
  timeZone: string;
}

/**
 * The CUSTOMER's side of booking (BOOKING-PLAN §6): the public page, and the
 * manage link. Nobody here is signed in.
 *
 * ## Two authorities, and nothing else
 *
 *   - the LINK ID names a workspace whose public page is TURNED ON. It is
 *     handed out, so it proves nothing about the visitor — it only says which
 *     shop they are looking at;
 *   - the MANAGE TOKEN names one booking, and is the customer's only
 *     credential. It is looked up by its hash.
 *
 * ⚠ ONE REFUSAL FOR EVERYTHING THAT IS NOT THERE. A link that does not exist, a
 * page that is turned off and a token nobody was given all answer the same —
 * `null` to a read, one sentence to a write — so the page cannot be used to
 * learn which links or tokens are real.
 *
 * ## What a visitor learns
 *
 * The shop's title and note (which the shop wrote for them), its services, its
 * resources' NAMES and their free times. Never who holds a taken time, and
 * never another customer's booking.
 *
 * ## What the app does not tell the customer (D3)
 *
 * Nothing is sent to them. Whether their request was confirmed is on their
 * manage link, which this service hands over once, when they ask.
 */
@Injectable()
export class BookingPublicService {
  private readonly logger = new Logger('BookingPublic');

  constructor(
    @Inject(BOOKING_PRISMA) private readonly prisma: BookingPrismaClient,
    private readonly reads: BookingReadService,
    private readonly writes: BookingWriteService,
    private readonly zones: BookingTimeZoneService,
    /** Unbound: nobody can be shown to work the desk, so nobody is told. */
    @Optional() @Inject(BOOKING_MEMBER_DIRECTORY) private readonly directory?: BookingMemberDirectory,
    /** Unbound: the desk is not told; the request still shows as waiting. */
    @Optional() @Inject(BOOKING_NOTIFIER) private readonly notifier?: BookingNotifier,
  ) {}

  // ── the public page ───────────────────────────────────────────────────────

  /** What the page shows, or null — for a link that does not exist AND a page that is turned off. */
  async page(linkId: string): Promise<BookingPublicPage | null> {
    const link = await this.open(linkId);
    if (!link) return null;
    const catalogue = await this.reads.catalogue(link.scope);
    const live = new Set(catalogue.resources.map(({ resource }) => resource.id));
    return {
      ...this.describe(link, new Date()),
      // Only what can actually be booked: a service nobody performs would offer no time at all.
      services: catalogue.services
        .filter(({ resourceIds }) => resourceIds.some((id) => live.has(id)))
        .map(({ service }) => service)
        .slice(0, PUBLIC_SERVICES_MAX),
    };
  }

  /**
   * The free times a CUSTOMER may ask for on one day: not sooner than the
   * notice the shop wants, and not past its horizon. Null for a link that is
   * not open; empty for a day outside the rules, or a service that is not this
   * shop's.
   */
  async slots(linkId: string, serviceId: string, day: string): Promise<BookingPublicSlots[] | null> {
    const link = await this.open(linkId);
    if (!link) return null;
    return this.slotsFor(link, serviceId, day, null);
  }

  /**
   * A customer asks for a booking. It is a REQUEST (D2): `pending`, holding its
   * slot, until staff confirm it — and the page must say so.
   *
   * Returns the manage token, ⚠ ONCE. It is stored only as its hash, so nobody
   * — not the desk, not a later read — can show it again.
   */
  async request(
    linkId: string,
    input: BookingCustomerInput & { serviceId: string; resourceId: string; startsAt: string },
  ): Promise<{ token: string; view: BookingPublicView }> {
    const link = await this.open(linkId);
    if (!link) throw refusalError('public_closed');
    const now = new Date();
    this.requireAllowedStart(link, input.startsAt, now);
    await this.requireRoomForRequest(link.scope, input);

    const { token, hash } = newManageToken();
    const appointment = await this.asVisitor(() => this.writes.request(link.scope, input, hash));
    const view = await this.viewOf(link, appointment, now);
    await this.tell('requestWaiting', view);
    return { token, view };
  }

  // ── the manage link ───────────────────────────────────────────────────────

  /**
   * One booking, for the holder of its manage token — or null, for a token
   * nobody was given.
   *
   * ⚠ It answers even when the public page has since been turned off: the
   * customer's booking still exists, and they must still be able to see where
   * it stands and cancel it.
   */
  async view(token: string): Promise<BookingPublicView | null> {
    const found = await this.byToken(token);
    return found ? this.viewOf(found.link, found.appointment, new Date()) : null;
  }

  /** The free times the holder of a token may move their booking to. Their own time does not block it. */
  async moveSlots(token: string, day: string): Promise<BookingPublicSlots[] | null> {
    const found = await this.byToken(token);
    if (!found) return null;
    return this.slotsFor(found.link, found.appointment.serviceId, day, found.appointment.id);
  }

  /** The customer cancels, until the cutoff. Past it the page says to contact the shop. */
  async cancel(token: string, reason: string | null | undefined): Promise<BookingPublicView> {
    const found = await this.byToken(token);
    if (!found) throw refusalError('not_found');
    const now = new Date();
    this.requireChangeable(found, now);
    const cancelled = await this.writes.cancelByCustomer(found.appointment, reason);
    const view = await this.viewOf(found.link, cancelled, now);
    await this.tell('customerCancelled', view);
    return view;
  }

  /**
   * The customer moves their booking, until the cutoff — to a time the public
   * rules allow. ⚠ It goes back to WAITING (D8), and the old time is given up
   * whether or not staff accept the new one.
   */
  async reschedule(token: string, startsAt: string, resourceId: string): Promise<BookingPublicView> {
    const found = await this.byToken(token);
    if (!found) throw refusalError('not_found');
    const now = new Date();
    this.requireChangeable(found, now);
    this.requireAllowedStart(found.link, startsAt, now);
    const moved = await this.asVisitor(() => this.writes.rescheduleByCustomer(found.appointment, startsAt, resourceId));
    const view = await this.viewOf(found.link, moved, now);
    await this.tell('customerRescheduled', view);
    return view;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** The workspace a link belongs to — only while its public page is turned on. */
  private async open(linkId: string): Promise<OpenLink | null> {
    if (typeof linkId !== 'string' || linkId.length === 0 || linkId.length > 64) return null;
    const row = await this.prisma.bookingSettings.findFirst({ where: { publicLinkId: linkId, publicEnabled: true } });
    if (!row) return null;
    return this.linkOf({ organizationId: row.organizationId, workspaceId: row.workspaceId });
  }

  private async linkOf(scope: BookingScope): Promise<OpenLink> {
    const [settings, timeZone] = await Promise.all([this.reads.settings(scope), this.zones.of(scope)]);
    return { scope, settings, timeZone };
  }

  /**
   * ⚠ BY THE HASH, and by nothing else: the token is the whole authority, so
   * the lookup names no workspace. A token of the wrong shape is hashed and
   * looked up like any other, so a refusal takes the same work either way.
   */
  private async byToken(token: string): Promise<{ link: OpenLink; appointment: BookingAppointmentRow } | null> {
    const hash = hashManageToken(typeof token === 'string' ? token.slice(0, 200) : '');
    const appointment = await this.prisma.bookingAppointment.findFirst({ where: { manageTokenHash: hash } });
    if (!appointment) return null;
    const link = await this.linkOf({
      organizationId: appointment.organizationId,
      workspaceId: appointment.workspaceId,
    });
    return { link, appointment };
  }

  private describe(link: OpenLink, now: Date): BookingPublicView['page'] {
    const today = workspaceBookingDay(now, link.timeZone);
    return {
      title: link.settings.publicTitle,
      note: link.settings.publicNote,
      timeZone: link.timeZone,
      today,
      lastDay: lastPublicDay(today, link.settings),
      cutoffMinutes: link.settings.cutoffMinutes,
    };
  }

  private async slotsFor(
    link: OpenLink,
    serviceId: string,
    day: string,
    forAppointmentId: string | null,
  ): Promise<BookingPublicSlots[]> {
    const now = new Date();
    const prepared = prepareBookingDay(day);
    if ('refused' in prepared) return [];
    const today = workspaceBookingDay(now, link.timeZone);
    if (prepared.day < today || prepared.day > lastPublicDay(today, link.settings)) return [];

    let slots: BookingResourceSlots[];
    try {
      slots = await this.reads.slots(
        link.scope,
        serviceId,
        prepared.day,
        forAppointmentId,
        earliestPublicStart(now, link.settings),
      );
    } catch (error) {
      // A service that is not this shop's is "nothing free", not a different answer.
      if (error instanceof BookingWriteError && error.reason === 'not_found') return [];
      throw error;
    }
    const offered = slots.filter((entry) => entry.starts.length > 0);
    if (offered.length === 0) return [];
    const catalogue = await this.reads.catalogue(link.scope);
    const names = new Map(catalogue.resources.map(({ resource }) => [resource.id, resource.name]));
    return offered.map((entry) => ({ ...entry, resourceName: names.get(entry.resourceId) ?? '' }));
  }

  /** The customer's notice and horizon, on the WORKSPACE's clock and calendar. */
  private requireAllowedStart(link: OpenLink, startsAtRaw: string, now: Date): void {
    const startsAt = parseBookingInstant(startsAtRaw);
    if (!startsAt) throw refusalError('invalid_time');
    const refusal = checkPublicStart(
      { startsAt, startDay: workspaceBookingDay(startsAt, link.timeZone) },
      { now, today: workspaceBookingDay(now, link.timeZone) },
      link.settings,
    );
    if (refusal) throw refusalError(refusal);
  }

  private requireChangeable(found: { link: OpenLink; appointment: BookingAppointmentRow }, now: Date): void {
    const refusal = checkCustomerChange(found.appointment, now, found.link.settings);
    if (refusal) throw refusalError(refusal);
  }

  /**
   * ⚠ THE PAGE TAKES NO SIGN-IN, so these two caps are what stands between a
   * visitor and a shop's whole week held by requests nobody means to keep:
   *
   *   - a way to reach the customer is REQUIRED — a request with no phone and
   *     no e-mail cannot be confirmed to anybody;
   *   - one contact may have only a few requests waiting at once;
   *   - and a workspace only so many from everybody, past which the page says
   *     to contact the shop.
   *
   * Advisory, not transactional: two requests at the same instant can both
   * pass. That is a request or two over a cap, never a double booking — the
   * slot itself is still taken inside the write's transaction.
   */
  private async requireRoomForRequest(scope: BookingScope, input: BookingCustomerInput): Promise<void> {
    // Compared as they will be STORED, so " 0917 555 " and "0917 555" are one contact.
    const prepared = prepareBookingCustomer(input);
    if ('refused' in prepared) throw refusalError(prepared.refused);
    const phone = prepared.customer.customerPhone ?? '';
    const email = prepared.customer.customerEmail ?? '';
    if (phone === '' && email === '') throw refusalError('contact_required');

    const pending = { ...scope, status: 'pending' as const };
    const [everybody, byPhone, byEmail] = await Promise.all([
      this.prisma.bookingAppointment.count({ where: pending }),
      phone === '' ? 0 : this.prisma.bookingAppointment.count({ where: { ...pending, customerPhone: phone } }),
      email === '' ? 0 : this.prisma.bookingAppointment.count({ where: { ...pending, customerEmail: email } }),
    ]);
    if (everybody >= BOOKING_REQUESTS_PER_WORKSPACE_MAX) throw refusalError('public_closed');
    if (Math.max(byPhone, byEmail) >= BOOKING_REQUESTS_PER_CONTACT_MAX) throw refusalError('too_many_requests');
  }

  /**
   * Runs a write on a visitor's behalf, answering what would tell them about
   * the shop's set-up with what they can act on: a service or resource that is
   * not there, is archived or does not fit is, to a customer, a time that is
   * not free.
   */
  private async asVisitor<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof BookingWriteError && HIDDEN_FROM_VISITORS.has(error.reason)) {
        throw refusalError('slot_taken');
      }
      throw error;
    }
  }

  private async viewOf(link: OpenLink, appointment: BookingAppointmentRow, now: Date): Promise<BookingPublicView> {
    const [names, found] = await Promise.all([
      this.reads.namesFor(link.scope, [appointment]),
      this.reads.appointment(link.scope, appointment.id),
    ]);
    return {
      page: this.describe(link, now),
      appointment,
      serviceName: names.services.get(appointment.serviceId) ?? '',
      resourceName: names.resources.get(appointment.resourceId) ?? '',
      reason: endReason(appointment, found?.changes ?? []),
      canChange: checkCustomerChange(appointment, now, link.settings) === null,
    };
  }

  /** Tells the desk, after the write. ⚠ Never fails what the customer did: the booking is saved either way. */
  private async tell(
    what: 'requestWaiting' | 'customerCancelled' | 'customerRescheduled',
    view: BookingPublicView,
  ): Promise<void> {
    if (!this.notifier || !this.directory) return;
    const { appointment } = view;
    try {
      const desk = await this.directory.listDesk(appointment.organizationId, appointment.workspaceId);
      if (desk.length === 0) return;
      const notice: BookingCustomerNotice = {
        recipientIds: desk.map((member) => member.userId),
        organizationId: appointment.organizationId,
        workspaceId: appointment.workspaceId,
        appointmentId: appointment.id,
        startsAt: appointment.startsAt.toISOString(),
        timeZone: view.page.timeZone,
        serviceName: view.serviceName,
        resourceName: view.resourceName,
        customerName: appointment.customerName,
      };
      await this.notifier[what](notice);
    } catch (error) {
      this.logger.warn(`The desk could not be told of a customer's ${what}: ${(error as Error).message}`);
    }
  }
}

/** Refusals that describe the shop's set-up. A visitor is told the time is not free instead. */
const HIDDEN_FROM_VISITORS: ReadonlySet<BookingRefusal> = new Set([
  'not_found',
  'service_archived',
  'resource_archived',
  'resource_cannot_perform',
  'outside_hours',
]);

/** Why a booking ended, for its customer: the reason on its last decline or cancellation, if one was given. */
function endReason(appointment: BookingAppointmentRow, changes: readonly BookingChangeRow[]): string {
  if (appointment.status !== 'declined' && appointment.status !== 'cancelled') return '';
  const last = [...changes].reverse().find((change) => change.kind === appointment.status);
  return last?.reason ?? '';
}
