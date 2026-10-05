import { declareScope, REQUIRED_SCOPE_METADATA, withCatchUp } from '@kwtech/module-kit';
import { Inject, Optional, SetMetadata } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { bookingEventFor } from '../../domain/events.js';
import { bookingDayFromDate } from '../../domain/time.js';
import { refusalError } from '../booking.errors.js';
import type { BookingModuleOptions } from '../booking.options.js';
import { BOOKING_EVENT, type BookingEvent, type BookingPubSub, NULL_BOOKING_PUBSUB } from '../booking.pubsub.js';
import type { BookingAppointmentRow, BookingChangeRow, BookingExceptionRow } from '../booking.repository.js';
import {
  type BookingNames,
  BookingReadService,
  type BookingResourceRead,
  type BookingServiceRead,
  type BookingSettingsRead,
} from '../booking.service.js';
import { BOOKING_OPTIONS, BOOKING_PUBSUB } from '../booking.tokens.js';
import { BookingCatalogueService } from '../booking-catalogue.service.js';
import { BookingWriteService } from '../booking-write.service.js';
import {
  BookingAppointmentDetailsInputType,
  BookingAppointmentDetailType,
  BookingAppointmentInputType,
  BookingAppointmentType,
  BookingCatalogueType,
  BookingChangeType,
  BookingDayType,
  BookingEventType,
  BookingExceptionInputType,
  BookingExceptionType,
  BookingHoursWindowInputType,
  BookingPersonType,
  BookingResourceInputType,
  BookingResourceSlotsType,
  BookingResourceType,
  BookingServiceInputType,
  BookingServiceType,
  BookingSettingsInputType,
  BookingSettingsType,
} from './booking.types.js';

/**
 * The booking GraphQL surface, for STAFF.
 *
 * ## ⚠ THE SCOPE IS DECLARED ON THE CLASS, and nothing here works without it
 *
 * Every `booking:*` key is WORKSPACE level. A resolver has no path, so without
 * a declaration `FeatureGuard` resolves app level — where no workspace key
 * participates — and every key grants nothing to everybody, silently (§12.13).
 * Declared on the CLASS so an operation added later cannot forget it;
 * `surface-coverage.test.ts` fails if it goes. Every operation therefore takes
 * `organizationId` and `workspaceId`.
 *
 * ## Where the guard is, since there is no decorator here
 *
 * Every operation is guarded by its BINDING in `BOOKING_FEATURE_REGISTRY`.
 *
 * ## And the guard is only half
 *
 * The key says what you may do in this workspace. The services find every row
 * by id AND that workspace, with one answer for "no such booking" and "a
 * booking somewhere else".
 *
 * ## Nothing here is public
 *
 * The customer's own page — asking for a booking, and the manage link — is a
 * separate resolver class with its own markers: `BookingPublicResolver`. It
 * does not belong in a class whose every operation is staff's.
 */
@SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('workspace'))
@Resolver()
export class BookingResolver {
  constructor(
    private readonly reads: BookingReadService,
    private readonly catalogue: BookingCatalogueService,
    private readonly writes: BookingWriteService,
    @Inject(BOOKING_OPTIONS) private readonly options: BookingModuleOptions,
    /** Absent means not live: `bookingEvents` sends `sync` and ends. */
    @Optional() @Inject(BOOKING_PUBSUB) private readonly pubsub?: BookingPubSub,
  ) {}

  // ── what can be booked: reading ───────────────────────────────────────────

  @Query(() => BookingCatalogueType, { name: 'bookingCatalogue' })
  async bookingCatalogue(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('includeArchived', { type: () => Boolean, nullable: true }) includeArchived?: boolean | null,
  ): Promise<BookingCatalogueType> {
    const read = await this.reads.catalogue({ organizationId, workspaceId }, includeArchived ?? false);
    const names = await this.reads.memberNames(read.resources.map(({ resource }) => resource.userId));
    return {
      services: read.services.map(renderService),
      resources: read.resources.map((resource) => renderResource(resource, names)),
    };
  }

  @Query(() => [BookingExceptionType], { name: 'bookingExceptions' })
  async bookingExceptions(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('fromDay') fromDay: string,
  ): Promise<BookingExceptionType[]> {
    const rows = await this.reads.exceptions({ organizationId, workspaceId }, fromDay);
    return rows.map(renderException);
  }

  /** Who a staff resource may be linked to. Bound to `booking:manage_services`. */
  @Query(() => [BookingPersonType], { name: 'bookingMembers' })
  async bookingMembers(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<BookingPersonType[]> {
    const members = await this.reads.members({ organizationId, workspaceId });
    return members.map((member) => ({ userId: member.userId, displayName: member.displayName }));
  }

  @Query(() => BookingSettingsType, { name: 'bookingSettings' })
  async bookingSettings(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<BookingSettingsType> {
    return renderSettings(await this.reads.settingsRead({ organizationId, workspaceId }));
  }

  // ── the day: reading ──────────────────────────────────────────────────────

  @Query(() => BookingDayType, { name: 'bookingDay' })
  async bookingDay(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('day') day: string,
  ): Promise<BookingDayType> {
    const scope = { organizationId, workspaceId };
    const read = await this.reads.day(scope, day);
    const names = await this.reads.namesFor(scope, read.appointments);
    return {
      day: read.day,
      timeZone: read.timeZone,
      appointments: read.appointments.map((row) => renderAppointment(row, names)),
      truncated: read.truncated,
    };
  }

  /** Every request waiting for staff, whatever day it is for, the longest-waiting first. */
  @Query(() => [BookingAppointmentType], { name: 'bookingRequests' })
  async bookingRequests(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<BookingAppointmentType[]> {
    const scope = { organizationId, workspaceId };
    const rows = await this.reads.requests(scope);
    const names = await this.reads.namesFor(scope, rows);
    return rows.map((row) => renderAppointment(row, names));
  }

  /** Null for a booking that does not exist AND for one in another workspace — the same answer. */
  @Query(() => BookingAppointmentDetailType, { name: 'bookingAppointment', nullable: true })
  async bookingAppointment(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('appointmentId') appointmentId: string,
  ): Promise<BookingAppointmentDetailType | null> {
    const scope = { organizationId, workspaceId };
    const found = await this.reads.appointment(scope, appointmentId);
    if (!found) return null;
    const names = await this.reads.namesFor(scope, [found.appointment], found.changes);
    return {
      ...renderAppointment(found.appointment, names),
      changes: found.changes.map((change) => renderChange(change, names)),
    };
  }

  @Query(() => [BookingResourceSlotsType], { name: 'bookingSlots' })
  async bookingSlots(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('serviceId') serviceId: string,
    @Args('day') day: string,
    @Args('forAppointmentId', { type: () => String, nullable: true }) forAppointmentId?: string | null,
  ): Promise<BookingResourceSlotsType[]> {
    const slots = await this.reads.slots({ organizationId, workspaceId }, serviceId, day, forAppointmentId ?? null);
    return slots.map((entry) => ({
      resourceId: entry.resourceId,
      starts: entry.starts.map((start) => start.toISOString()),
    }));
  }

  /**
   * "Something changed here; read again."
   *
   * ⚠ Filtered PER SUBSCRIBER to their own workspace, and carrying ids only —
   * never a customer's name. The key was checked once, at subscribe time, by
   * the binding.
   */
  @Subscription(() => BookingEventType, {
    name: 'bookingEvents',
    // ⚠ REQUIRED: without it GraphQL looks for a `bookingEvents` key on the
    // payload, finds none, and delivers `data: null` forever.
    resolve: (payload: BookingEventType) => payload,
  })
  bookingEvents(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): AsyncIterableIterator<BookingEventType> {
    // Resolved now, at subscribe time: a socket with nobody behind it gets no stream.
    this.actor(gql.req);
    const viewer = { organizationId, workspaceId };
    return withCatchUp<BookingEvent, BookingEventType>({
      live: (this.pubsub ?? NULL_BOOKING_PUBSUB).asyncIterableIterator<BookingEvent>(BOOKING_EVENT.changed),
      catchUp: async () => [{ kind: 'sync', appointmentId: null, actorId: null }],
      transform: (event) => {
        const kind = bookingEventFor(event, viewer);
        if (!kind) return null;
        return { kind, appointmentId: event.appointmentId, actorId: event.actorId };
      },
      keyOf: () => null,
    });
  }

  // ── what can be booked: writing ───────────────────────────────────────────

  @Mutation(() => BookingServiceType, { name: 'saveBookingService' })
  async saveBookingService(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('serviceId', { type: () => String, nullable: true }) serviceId: string | null,
    @Args('input', { type: () => BookingServiceInputType }) input: BookingServiceInputType,
  ): Promise<BookingServiceType> {
    const scope = { organizationId, workspaceId };
    return renderService(await this.catalogue.saveService(scope, this.actor(gql.req), serviceId ?? null, { ...input }));
  }

  @Mutation(() => BookingServiceType, { name: 'setBookingServiceArchived' })
  async setBookingServiceArchived(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('serviceId') serviceId: string,
    @Args('archived') archived: boolean,
  ): Promise<BookingServiceType> {
    const scope = { organizationId, workspaceId };
    return renderService(await this.catalogue.setServiceArchived(scope, this.actor(gql.req), serviceId, archived));
  }

  @Mutation(() => BookingResourceType, { name: 'saveBookingResource' })
  async saveBookingResource(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('resourceId', { type: () => String, nullable: true }) resourceId: string | null,
    @Args('input', { type: () => BookingResourceInputType }) input: BookingResourceInputType,
  ): Promise<BookingResourceType> {
    const scope = { organizationId, workspaceId };
    return this.renderOneResource(
      await this.catalogue.saveResource(scope, this.actor(gql.req), resourceId ?? null, { ...input }),
    );
  }

  @Mutation(() => BookingResourceType, { name: 'setBookingResourceArchived' })
  async setBookingResourceArchived(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('resourceId') resourceId: string,
    @Args('archived') archived: boolean,
  ): Promise<BookingResourceType> {
    const scope = { organizationId, workspaceId };
    return this.renderOneResource(
      await this.catalogue.setResourceArchived(scope, this.actor(gql.req), resourceId, archived),
    );
  }

  /** The resource's WHOLE week, replacing what was there. */
  @Mutation(() => BookingResourceType, { name: 'setBookingResourceHours' })
  async setBookingResourceHours(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('resourceId') resourceId: string,
    @Args('hours', { type: () => [BookingHoursWindowInputType] }) hours: BookingHoursWindowInputType[],
  ): Promise<BookingResourceType> {
    const scope = { organizationId, workspaceId };
    return this.renderOneResource(await this.catalogue.setResourceHours(scope, this.actor(gql.req), resourceId, hours));
  }

  @Mutation(() => BookingExceptionType, { name: 'addBookingException' })
  async addBookingException(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => BookingExceptionInputType }) input: BookingExceptionInputType,
  ): Promise<BookingExceptionType> {
    const scope = { organizationId, workspaceId };
    return renderException(await this.catalogue.addException(scope, this.actor(gql.req), { ...input }));
  }

  @Mutation(() => Boolean, { name: 'removeBookingException' })
  async removeBookingException(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('exceptionId') exceptionId: string,
  ): Promise<boolean> {
    await this.catalogue.removeException({ organizationId, workspaceId }, this.actor(gql.req), exceptionId);
    return true;
  }

  @Mutation(() => BookingSettingsType, { name: 'saveBookingSettings' })
  async saveBookingSettings(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => BookingSettingsInputType }) input: BookingSettingsInputType,
  ): Promise<BookingSettingsType> {
    const scope = { organizationId, workspaceId };
    return renderSettings(await this.catalogue.saveSettings(scope, this.actor(gql.req), { ...input }));
  }

  /** Replaces the public page's address: the old one stops working at once. Bound to `booking:manage_settings`. */
  @Mutation(() => BookingSettingsType, { name: 'resetBookingPublicLink' })
  async resetBookingPublicLink(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<BookingSettingsType> {
    return renderSettings(await this.catalogue.resetPublicLink({ organizationId, workspaceId }, this.actor(gql.req)));
  }

  // ── bookings: writing ─────────────────────────────────────────────────────

  @Mutation(() => BookingAppointmentType, { name: 'createBookingAppointment' })
  async createBookingAppointment(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => BookingAppointmentInputType }) input: BookingAppointmentInputType,
  ): Promise<BookingAppointmentType> {
    const scope = { organizationId, workspaceId };
    return this.renderOne(scope, await this.writes.create(scope, this.actor(gql.req), { ...input }));
  }

  @Mutation(() => BookingAppointmentType, { name: 'rescheduleBookingAppointment' })
  async rescheduleBookingAppointment(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('appointmentId') appointmentId: string,
    @Args('startsAt') startsAt: string,
    @Args('resourceId') resourceId: string,
  ): Promise<BookingAppointmentType> {
    const scope = { organizationId, workspaceId };
    return this.renderOne(
      scope,
      await this.writes.reschedule(scope, this.actor(gql.req), appointmentId, startsAt, resourceId),
    );
  }

  @Mutation(() => BookingAppointmentType, { name: 'updateBookingAppointmentDetails' })
  async updateBookingAppointmentDetails(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('appointmentId') appointmentId: string,
    @Args('input', { type: () => BookingAppointmentDetailsInputType }) input: BookingAppointmentDetailsInputType,
  ): Promise<BookingAppointmentType> {
    const scope = { organizationId, workspaceId };
    return this.renderOne(
      scope,
      await this.writes.updateDetails(scope, this.actor(gql.req), appointmentId, { ...input }),
    );
  }

  @Mutation(() => BookingAppointmentType, { name: 'confirmBookingAppointment' })
  async confirmBookingAppointment(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('appointmentId') appointmentId: string,
  ): Promise<BookingAppointmentType> {
    const scope = { organizationId, workspaceId };
    return this.renderOne(scope, await this.writes.confirm(scope, this.actor(gql.req), appointmentId));
  }

  @Mutation(() => BookingAppointmentType, { name: 'declineBookingAppointment' })
  async declineBookingAppointment(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('appointmentId') appointmentId: string,
    @Args('reason', { type: () => String, nullable: true }) reason?: string | null,
  ): Promise<BookingAppointmentType> {
    const scope = { organizationId, workspaceId };
    return this.renderOne(scope, await this.writes.decline(scope, this.actor(gql.req), appointmentId, reason));
  }

  /** `status` is `arrived`, `done` or `no_show`. */
  @Mutation(() => BookingAppointmentType, { name: 'markBookingAppointment' })
  async markBookingAppointment(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('appointmentId') appointmentId: string,
    @Args('status') status: string,
  ): Promise<BookingAppointmentType> {
    const scope = { organizationId, workspaceId };
    return this.renderOne(scope, await this.writes.mark(scope, this.actor(gql.req), appointmentId, status));
  }

  /** Bound to `booking:cancel_appointments`, on its own. */
  @Mutation(() => BookingAppointmentType, { name: 'cancelBookingAppointment' })
  async cancelBookingAppointment(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('appointmentId') appointmentId: string,
    @Args('reason') reason: string,
  ): Promise<BookingAppointmentType> {
    const scope = { organizationId, workspaceId };
    return this.renderOne(scope, await this.writes.cancel(scope, this.actor(gql.req), appointmentId, reason));
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async renderOne(
    scope: { organizationId: string; workspaceId: string },
    row: BookingAppointmentRow,
  ): Promise<BookingAppointmentType> {
    return renderAppointment(row, await this.reads.namesFor(scope, [row]));
  }

  private async renderOneResource(read: BookingResourceRead): Promise<BookingResourceType> {
    return renderResource(read, await this.reads.memberNames([read.resource.userId]));
  }

  /** The principal's id, proven by the app's guard. The module never learns what a session is. */
  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw refusalError('not_signed_in');
    return actorId;
  }
}

function renderSettings(read: BookingSettingsRead): BookingSettingsType {
  return { ...read.settings, publicLinkId: read.publicLinkId };
}

function renderService({ service, resourceIds }: BookingServiceRead): BookingServiceType {
  return {
    id: service.id,
    name: service.name,
    durationMinutes: service.durationMinutes,
    bufferBeforeMinutes: service.bufferBeforeMinutes,
    bufferAfterMinutes: service.bufferAfterMinutes,
    price: service.price,
    resourceIds: [...resourceIds],
    archivedAt: service.archivedAt?.toISOString() ?? null,
  };
}

function renderResource(
  { resource, hours }: BookingResourceRead,
  names: ReadonlyMap<string, string>,
): BookingResourceType {
  return {
    id: resource.id,
    name: resource.name,
    kind: resource.kind,
    userId: resource.userId,
    userName: resource.userId ? (names.get(resource.userId) ?? null) : null,
    hours: hours.map((row) => ({ weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute })),
    archivedAt: resource.archivedAt?.toISOString() ?? null,
  };
}

function renderException(row: BookingExceptionRow): BookingExceptionType {
  return {
    id: row.id,
    resourceId: row.resourceId,
    day: bookingDayFromDate(row.day),
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    note: row.note,
  };
}

function renderAppointment(row: BookingAppointmentRow, names: BookingNames): BookingAppointmentType {
  return {
    id: row.id,
    serviceId: row.serviceId,
    // Both exist: a booking's service and resource are archived, never deleted. The fallback is for a read that raced.
    serviceName: names.services.get(row.serviceId) ?? '',
    resourceId: row.resourceId,
    resourceName: names.resources.get(row.resourceId) ?? '',
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerEmail: row.customerEmail,
    note: row.note,
    createdById: row.createdById,
    createdByName: row.createdById ? (names.members.get(row.createdById) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function renderChange(row: BookingChangeRow, names: BookingNames): BookingChangeType {
  return {
    id: row.id,
    kind: row.kind,
    actorKind: row.actorKind,
    actorId: row.actorId,
    actorName: row.actorId ? (names.members.get(row.actorId) ?? null) : null,
    fromStartsAt: row.fromStartsAt?.toISOString() ?? null,
    toStartsAt: row.toStartsAt?.toISOString() ?? null,
    fromResourceName: row.fromResourceId ? (names.resources.get(row.fromResourceId) ?? null) : null,
    toResourceName: row.toResourceId ? (names.resources.get(row.toResourceId) ?? null) : null,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}
