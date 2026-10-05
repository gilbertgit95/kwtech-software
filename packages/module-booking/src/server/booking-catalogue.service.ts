import type { LimitChecker, LimitDecision } from '@kwtech/module-kit';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BOOKING_SERVICES_MAX,
  type BookingResourceInput,
  type BookingServiceInput,
  type BookingSettingsPatch,
  prepareBookingResource,
  prepareBookingService,
  prepareBookingSettings,
} from '../domain/catalogue.js';
import { type BookingExceptionInput, prepareBookingException, prepareBookingHours } from '../domain/hours.js';
import { bookingDayToDate } from '../domain/time.js';
import { BOOKING_LIMIT, BOOKING_LIMIT_REGISTRY } from '../feature-keys.js';
import type { BookingRefusal, BookingWindow } from '../types.js';
import { BookingWriteError, bookingNotFound, refusalError } from './booking.errors.js';
import { BookingEventPublisher } from './booking.events.js';
import { type BookingScope, loadResource, loadService } from './booking.lookup.js';
import type { BookingExceptionRow, BookingWriteClient } from './booking.repository.js';
import {
  BookingReadService,
  type BookingResourceRead,
  type BookingServiceRead,
  type BookingSettingsRead,
} from './booking.service.js';
import { BOOKING_LIMIT_CHECKER, BOOKING_MEMBER_DIRECTORY, BOOKING_PRISMA_WRITE } from './booking.tokens.js';
import { newPublicLinkId } from './booking-secrets.js';
import type { BookingMemberDirectory } from './ports.js';

/**
 * Every write to what can be booked: services, resources, their hours, closed
 * days, and the workspace's settings.
 *
 * ⚠ NONE OF THESE MOVES OR CANCELS A BOOKING ALREADY MADE. Shorter hours, a
 * closed day or an archived resource change what is OFFERED from now on; the
 * bookings inside them stay, and the desk moves or cancels each one itself,
 * because each is a promise to a customer the app cannot tell (BOOKING-PLAN
 * §8, D3 with D7).
 */
@Injectable()
export class BookingCatalogueService {
  constructor(
    @Inject(BOOKING_PRISMA_WRITE) private readonly prisma: BookingWriteClient,
    private readonly reads: BookingReadService,
    private readonly events: BookingEventPublisher,
    /** Unbound: the declared default cap. */
    @Optional() @Inject(BOOKING_LIMIT_CHECKER) private readonly limits?: LimitChecker,
    /** Unbound: no member can be linked to a resource. */
    @Optional() @Inject(BOOKING_MEMBER_DIRECTORY) private readonly directory?: BookingMemberDirectory,
  ) {}

  // ── services ──────────────────────────────────────────────────────────────

  /**
   * Creates a service, or changes one. Its list of resources is REPLACED by the
   * one given.
   *
   * Changing a duration or a buffer does not move a booking already made: each
   * booking carries the times it was made with (`blockedFrom`, `blockedUntil`).
   */
  async saveService(
    scope: BookingScope,
    actorId: string,
    serviceId: string | null,
    input: BookingServiceInput,
  ): Promise<BookingServiceRead> {
    const { service: prepared } = unwrap(prepareBookingService(input));
    const { resourceIds, ...fields } = prepared;

    const id = await this.prisma.$transaction(async (tx) => {
      // ⚠ Every resource named must be one of THIS workspace's. An id from another tenant matches nothing here.
      const found =
        resourceIds.length === 0
          ? []
          : await tx.bookingResource.findMany({
              where: { ...scope, id: { in: resourceIds } },
              orderBy: [{ id: 'asc' }],
              take: resourceIds.length,
            });
      if (found.length !== resourceIds.length) throw refusalError('invalid_resources');

      let savedId = serviceId;
      if (savedId === null) {
        // ⚠ Counted in the transaction that inserts, archived services included.
        const current = await tx.bookingService.count({ where: scope });
        if (current >= BOOKING_SERVICES_MAX) throw refusalError('too_many_services');
        savedId = (await tx.bookingService.create({ data: { ...scope, ...fields } })).id;
      } else {
        const changed = await tx.bookingService.updateMany({ where: { ...scope, id: savedId }, data: fields });
        if (changed.count === 0) throw bookingNotFound();
      }

      await tx.bookingServiceResource.deleteMany({ where: { serviceId: savedId } });
      // One at a time: the structural client has no bulk create, and a service lists a handful.
      for (const resourceId of resourceIds) {
        await tx.bookingServiceResource.create({ data: { ...scope, serviceId: savedId, resourceId } });
      }
      return savedId;
    });

    await this.events.changed(scope, 'catalogue', actorId);
    return this.readService(scope, id);
  }

  /** Archives a service, or restores it. An archived one is offered no times; its bookings stay. */
  async setServiceArchived(
    scope: BookingScope,
    actorId: string,
    serviceId: string,
    archived: boolean,
  ): Promise<BookingServiceRead> {
    const changed = await this.prisma.bookingService.updateMany({
      where: { ...scope, id: serviceId },
      data: { archivedAt: archived ? new Date() : null },
    });
    if (changed.count === 0) throw bookingNotFound();
    await this.events.changed(scope, 'catalogue', actorId);
    return this.readService(scope, serviceId);
  }

  // ── resources ─────────────────────────────────────────────────────────────

  /**
   * Creates a resource, or changes one.
   *
   * ⚠ THE CAP IS COUNTED IN THE TRANSACTION THAT INSERTS: live resources of the
   * workspace, against `booking:resources`.
   */
  async saveResource(
    scope: BookingScope,
    actorId: string,
    resourceId: string | null,
    input: BookingResourceInput,
  ): Promise<BookingResourceRead> {
    const { resource: prepared } = unwrap(prepareBookingResource(input));
    if (prepared.userId !== null) await this.requireDeskMember(scope, prepared.userId);

    const id = await this.prisma.$transaction(async (tx) => {
      if (resourceId !== null) {
        const changed = await tx.bookingResource.updateMany({ where: { ...scope, id: resourceId }, data: prepared });
        if (changed.count === 0) throw bookingNotFound();
        return resourceId;
      }
      const current = await tx.bookingResource.count({ where: { ...scope, archivedAt: null } });
      await this.requireRoom(scope, actorId, current);
      return (await tx.bookingResource.create({ data: { ...scope, ...prepared } })).id;
    });

    await this.events.changed(scope, 'catalogue', actorId);
    return this.readResource(scope, id);
  }

  /**
   * Archives a resource, or restores it.
   *
   * ⚠ RESTORING IS CHECKED AGAINST THE CAP like adding one: an archived
   * resource does not count, so restoring unchecked would be the way round it.
   */
  async setResourceArchived(
    scope: BookingScope,
    actorId: string,
    resourceId: string,
    archived: boolean,
  ): Promise<BookingResourceRead> {
    await this.prisma.$transaction(async (tx) => {
      const resource = await loadResource(tx, scope, resourceId);
      if ((resource.archivedAt !== null) === archived) return;
      if (!archived) {
        const current = await tx.bookingResource.count({ where: { ...scope, archivedAt: null } });
        await this.requireRoom(scope, actorId, current);
      }
      await tx.bookingResource.updateMany({
        where: { ...scope, id: resourceId },
        data: { archivedAt: archived ? new Date() : null },
      });
    });
    await this.events.changed(scope, 'catalogue', actorId);
    return this.readResource(scope, resourceId);
  }

  /** A resource's WHOLE week, replacing what was there. An empty list closes it every day. */
  async setResourceHours(
    scope: BookingScope,
    actorId: string,
    resourceId: string,
    hours: readonly BookingWindow[],
  ): Promise<BookingResourceRead> {
    const { hours: prepared } = unwrap(prepareBookingHours(hours));
    await this.prisma.$transaction(async (tx) => {
      const resource = await loadResource(tx, scope, resourceId);
      await tx.bookingHours.deleteMany({ where: { resourceId: resource.id } });
      // One at a time: at most 28 rows, and the structural client has no bulk create.
      for (const window of prepared) {
        await tx.bookingHours.create({ data: { ...scope, resourceId: resource.id, ...window } });
      }
    });
    await this.events.changed(scope, 'catalogue', actorId);
    return this.readResource(scope, resourceId);
  }

  // ── closed days ───────────────────────────────────────────────────────────

  /** Closes a day, or a stretch of one — for one resource, or for all of them when none is named. */
  async addException(
    scope: BookingScope,
    actorId: string,
    input: BookingExceptionInput & { resourceId?: string | null | undefined },
  ): Promise<BookingExceptionRow> {
    const { exception } = unwrap(prepareBookingException(input));
    const resourceId = input.resourceId ?? null;
    // ⚠ Found by id AND scope: a resource of another workspace cannot be closed from here.
    if (resourceId !== null) await loadResource(this.prisma, scope, resourceId);

    const row = await this.prisma.bookingException.create({
      data: {
        ...scope,
        resourceId,
        day: bookingDayToDate(exception.day),
        startMinute: exception.startMinute,
        endMinute: exception.endMinute,
        note: exception.note,
        createdById: actorId,
      },
    });
    await this.events.changed(scope, 'catalogue', actorId);
    return row;
  }

  /** Reopens what an exception closed. */
  async removeException(scope: BookingScope, actorId: string, exceptionId: string): Promise<void> {
    const removed = await this.prisma.bookingException.deleteMany({ where: { ...scope, id: exceptionId } });
    if (removed.count === 0) throw bookingNotFound();
    await this.events.changed(scope, 'catalogue', actorId);
  }

  // ── settings ──────────────────────────────────────────────────────────────

  /**
   * Saves the workspace's settings. Only what is given changes: a caller that
   * sends the slot size alone leaves the public page exactly as it was.
   *
   * ⚠ THE LINK IS MADE HERE, the first time the public page is turned on, and
   * kept when it is turned off — so turning it back on restores the address
   * customers already have. Only `resetPublicLink` retires one.
   */
  async saveSettings(scope: BookingScope, actorId: string, input: BookingSettingsPatch): Promise<BookingSettingsRead> {
    const current = await this.reads.settingsRead(scope);
    // Nulls are "not given", as omissions are: GraphQL sends both for an optional field.
    const given = Object.fromEntries(Object.entries(input).filter(([, value]) => value != null));
    const { settings } = unwrap(prepareBookingSettings({ ...current.settings, ...given }));
    const publicLinkId = current.publicLinkId ?? (settings.publicEnabled ? newPublicLinkId() : null);

    await this.prisma.bookingSettings.upsert({
      where: { workspaceId: scope.workspaceId },
      create: { ...scope, ...settings, publicLinkId },
      update: { ...settings, publicLinkId },
    });
    await this.events.changed(scope, 'settings', actorId);
    return { settings, publicLinkId };
  }

  /**
   * Replaces the public page's address. ⚠ THE OLD ADDRESS STOPS WORKING AT
   * ONCE, wherever it was posted — that is the point of it. Manage links are
   * not touched: each is its own token, and a customer with a booking keeps it.
   */
  async resetPublicLink(scope: BookingScope, actorId: string): Promise<BookingSettingsRead> {
    const current = await this.reads.settingsRead(scope);
    const publicLinkId = newPublicLinkId();
    await this.prisma.bookingSettings.upsert({
      where: { workspaceId: scope.workspaceId },
      create: { ...scope, ...current.settings, publicLinkId },
      update: { publicLinkId },
    });
    await this.events.changed(scope, 'settings', actorId);
    return { settings: current.settings, publicLinkId };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async readService(scope: BookingScope, serviceId: string): Promise<BookingServiceRead> {
    const [read] = await this.reads.withResources([await loadService(this.prisma, scope, serviceId)]);
    if (!read) throw bookingNotFound();
    return read;
  }

  private async readResource(scope: BookingScope, resourceId: string): Promise<BookingResourceRead> {
    const [read] = await this.reads.withHours([await loadResource(this.prisma, scope, resourceId)]);
    if (!read) throw bookingNotFound();
    return read;
  }

  /** ⚠ Unbound directory: nobody can be shown to work here, so nobody is linked — fail closed. */
  private async requireDeskMember(scope: BookingScope, userId: string): Promise<void> {
    const desk = this.directory ? await this.directory.listDesk(scope.organizationId, scope.workspaceId) : [];
    if (!desk.some((member) => member.userId === userId)) throw refusalError('invalid_member');
  }

  private async requireRoom(scope: BookingScope, actorId: string, current: number): Promise<void> {
    const decision = await this.checkCap(scope, actorId, current);
    if (decision.allowed) return;
    throw new BookingWriteError(
      'limit_reached',
      `This workspace can take bookings for ${decision.limit} resources — archive one, or upgrade the plan`,
      { limit: decision.limit },
    );
  }

  private async checkCap(scope: BookingScope, actorId: string, current: number): Promise<LimitDecision> {
    if (this.limits) return this.limits.check({ actorId, key: BOOKING_LIMIT.resources, current, ...scope });
    // ⚠ Unbound means the DECLARED default — an unset cap is a floor, never unlimited.
    const cap = BOOKING_LIMIT_REGISTRY.find((spec) => spec.key === BOOKING_LIMIT.resources)?.defaultValue ?? 0;
    return { allowed: current < cap, limit: cap, current, remaining: Math.max(cap - current, 0) };
  }
}

function unwrap<T extends object>(result: T | { refused: BookingRefusal }): T {
  if ('refused' in result) throw refusalError(result.refused);
  return result;
}
