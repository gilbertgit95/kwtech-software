import { Inject, Injectable, Optional } from '@nestjs/common';
import { type BookingSettingsValues, normalizeBookingSettings } from '../domain/catalogue.js';
import { BOOKING_HOLDING_STATUSES, freeSlotStarts } from '../domain/slots.js';
import { addMinutes, bookingDayRange, bookingDayToDate, MINUTES_PER_DAY, prepareBookingDay } from '../domain/time.js';
import { bookingNotFound, refusalError } from './booking.errors.js';
import { type BookingScope, openWindowsOn } from './booking.lookup.js';
import type {
  BookingAppointmentRow,
  BookingChangeRow,
  BookingExceptionRow,
  BookingHoursRow,
  BookingPrismaClient,
  BookingResourceRow,
  BookingServiceRow,
} from './booking.repository.js';
import { BOOKING_MEMBER_DIRECTORY, BOOKING_PRISMA } from './booking.tokens.js';
import { BookingTimeZoneService } from './booking-time-zone.service.js';
import type { BookingMember, BookingMemberDirectory } from './ports.js';

/** How many services, and how many resources, one catalogue read returns. Above the caps on both. */
export const BOOKING_CATALOGUE_READ_MAX = 500;

/**
 * How many bookings one day's read returns. A day past five hundred is not read
 * as a list any more; the app says the list was cut (`truncated`) rather than
 * pretending it is whole.
 */
export const BOOKING_DAY_READ_MAX = 500;

/** How many upcoming closures the settings screen lists. */
export const BOOKING_EXCEPTIONS_READ_MAX = 500;

/** How many entries of one booking's history are read. A booking moved two hundred times has other problems. */
export const BOOKING_CHANGES_READ_MAX = 200;

/** How many holding bookings one slot read considers across a service's resources. */
const BOOKING_BUSY_READ_MAX = 2000;

export interface BookingServiceRead {
  service: BookingServiceRow;
  /** The resources that can perform it, live or archived. */
  resourceIds: readonly string[];
}

export interface BookingResourceRead {
  resource: BookingResourceRow;
  hours: readonly BookingHoursRow[];
}

export interface BookingCatalogueRead {
  services: readonly BookingServiceRead[];
  resources: readonly BookingResourceRead[];
}

export interface BookingDayRead {
  day: string;
  /** The workspace's zone, in which `day` was cut. */
  timeZone: string;
  appointments: readonly BookingAppointmentRow[];
  /** More bookings start that day than `BOOKING_DAY_READ_MAX`. */
  truncated: boolean;
}

export interface BookingResourceSlots {
  resourceId: string;
  /** The starts still free, in order. */
  starts: readonly Date[];
}

/** A workspace's settings, with the address of its public page. */
export interface BookingSettingsRead {
  settings: BookingSettingsValues;
  /** `/book/<publicLinkId>`. Null until the page has been turned on once. */
  publicLinkId: string | null;
}

/** How many waiting requests one read returns. Above the cap on how many a workspace may have waiting. */
export const BOOKING_REQUESTS_READ_MAX = 300;

/** The names a rendered booking shows, looked up once for a page of them. */
export interface BookingNames {
  services: ReadonlyMap<string, string>;
  resources: ReadonlyMap<string, string>;
  members: ReadonlyMap<string, string>;
}

/**
 * Reading bookings. Every query names its workspace and organization: the
 * guard proved the caller is a member of the workspace in the request, not that
 * the row asked for is in it.
 *
 * Named `BookingReadService` rather than the usual `BookingService`, because in
 * this module a "booking service" is a thing a customer books
 * (`BookingServiceRow`), and one name for both would be read wrongly half the
 * time.
 */
@Injectable()
export class BookingReadService {
  constructor(
    @Inject(BOOKING_PRISMA) private readonly prisma: BookingPrismaClient,
    private readonly zones: BookingTimeZoneService,
    /** Unbound: nobody has a name, and nobody can be linked to a resource. */
    @Optional() @Inject(BOOKING_MEMBER_DIRECTORY) private readonly directory?: BookingMemberDirectory,
  ) {}

  /** Services with their resources, and resources with their hours. */
  async catalogue(scope: BookingScope, includeArchived = false): Promise<BookingCatalogueRead> {
    const live = includeArchived ? {} : { archivedAt: null };
    const [services, resources] = await Promise.all([
      this.prisma.bookingService.findMany({
        where: { ...scope, ...live },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: BOOKING_CATALOGUE_READ_MAX,
      }),
      this.prisma.bookingResource.findMany({
        where: { ...scope, ...live },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: BOOKING_CATALOGUE_READ_MAX,
      }),
    ]);
    return {
      services: await this.withResources(services),
      resources: await this.withHours(resources),
    };
  }

  async withResources(services: readonly BookingServiceRow[]): Promise<BookingServiceRead[]> {
    if (services.length === 0) return [];
    const links = await this.prisma.bookingServiceResource.findMany({
      where: { serviceId: { in: services.map((service) => service.id) } },
    });
    return services.map((service) => ({
      service,
      resourceIds: links.filter((link) => link.serviceId === service.id).map((link) => link.resourceId),
    }));
  }

  async withHours(resources: readonly BookingResourceRow[]): Promise<BookingResourceRead[]> {
    if (resources.length === 0) return [];
    const hours = await this.prisma.bookingHours.findMany({
      where: { resourceId: { in: resources.map((resource) => resource.id) } },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });
    return resources.map((resource) => ({
      resource,
      hours: hours.filter((row) => row.resourceId === resource.id),
    }));
  }

  /** Closed days and stretches from `fromDay` on, the workspace-wide ones included. */
  async exceptions(scope: BookingScope, fromDay: string): Promise<BookingExceptionRow[]> {
    const prepared = prepareBookingDay(fromDay);
    if ('refused' in prepared) throw refusalError(prepared.refused);
    return this.prisma.bookingException.findMany({
      where: { ...scope, day: { gte: bookingDayToDate(prepared.day) } },
      orderBy: [{ day: 'asc' }, { id: 'asc' }],
      take: BOOKING_EXCEPTIONS_READ_MAX,
    });
  }

  /**
   * ONE WORKSPACE DAY's bookings, in order, whatever their status: a cancelled
   * booking stays on the day it was for (D7).
   *
   * ⚠ The day is cut in the WORKSPACE's zone. A booking at 11 PM in Manila is
   * on that day's list, while the server already calls it tomorrow.
   */
  async day(scope: BookingScope, day: string): Promise<BookingDayRead> {
    const prepared = prepareBookingDay(day);
    if ('refused' in prepared) throw refusalError(prepared.refused);
    const timeZone = await this.zones.of(scope);
    const range = bookingDayRange(prepared.day, timeZone);
    if (!range) throw refusalError('invalid_day');

    const rows = await this.prisma.bookingAppointment.findMany({
      where: { ...scope, startsAt: { gte: range.from, lt: range.until } },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: BOOKING_DAY_READ_MAX + 1,
    });
    return {
      day: prepared.day,
      timeZone,
      appointments: rows.slice(0, BOOKING_DAY_READ_MAX),
      truncated: rows.length > BOOKING_DAY_READ_MAX,
    };
  }

  /** One booking and its history, oldest first — or null, for one that does not exist AND one in another workspace. */
  async appointment(
    scope: BookingScope,
    appointmentId: string,
  ): Promise<{ appointment: BookingAppointmentRow; changes: BookingChangeRow[] } | null> {
    const appointment = await this.prisma.bookingAppointment.findFirst({ where: { ...scope, id: appointmentId } });
    if (!appointment) return null;
    const changes = await this.prisma.bookingChange.findMany({
      where: { appointmentId: appointment.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: BOOKING_CHANGES_READ_MAX,
    });
    return { appointment, changes };
  }

  /**
   * The starts still free on one workspace day, for each LIVE resource that can
   * perform the service. An archived service is offered nothing.
   *
   * ⚠ COMPUTED, every time: hours, minus closures, minus the bookings that hold
   * a slot. Nothing is stored, so nothing can be stale.
   *
   * A service or a workspace that does not exist answers `not_found`; the
   * public page turns that into its one refusal.
   *
   * @param forAppointmentId a booking being MOVED, whose own slot must not block
   *   it: moving a 2:00 booking to 2:30 is not a clash with itself.
   */
  async slots(
    scope: BookingScope,
    serviceId: string,
    day: string,
    forAppointmentId: string | null = null,
    /**
     * Nothing at or before this is offered. Omitted: now — staff book any time
     * still ahead. The public page passes now plus the notice it asks for.
     */
    earliest: Date | null = null,
  ): Promise<BookingResourceSlots[]> {
    const prepared = prepareBookingDay(day);
    if ('refused' in prepared) throw refusalError(prepared.refused);
    const service = await this.prisma.bookingService.findFirst({ where: { ...scope, id: serviceId } });
    if (!service) throw bookingNotFound();
    if (service.archivedAt !== null) return [];

    const links = await this.prisma.bookingServiceResource.findMany({ where: { serviceId: service.id } });
    if (links.length === 0) return [];
    const [resources, timeZone, settings] = await Promise.all([
      this.prisma.bookingResource.findMany({
        where: { ...scope, id: { in: links.map((link) => link.resourceId) } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: BOOKING_CATALOGUE_READ_MAX,
      }),
      this.zones.of(scope),
      this.settings(scope),
    ]);
    const live = resources.filter((resource) => resource.archivedAt === null);
    const range = bookingDayRange(prepared.day, timeZone);
    if (live.length === 0 || !range) return [];

    const now = new Date();
    const resourceIds = live.map((resource) => resource.id);
    const [windows, busy] = await Promise.all([
      openWindowsOn(this.prisma, scope, resourceIds, prepared.day),
      this.prisma.bookingAppointment.findMany({
        where: {
          ...scope,
          resourceId: { in: resourceIds },
          status: { in: [...BOOKING_HOLDING_STATUSES] },
          // A day either side: a booking's buffers can reach across midnight into this day.
          blockedFrom: { lt: addMinutes(range.until, MINUTES_PER_DAY) },
          blockedUntil: { gt: addMinutes(range.from, -MINUTES_PER_DAY) },
          ...(forAppointmentId ? { id: { not: forAppointmentId } } : {}),
        },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: BOOKING_BUSY_READ_MAX,
      }),
    ]);

    return live.map((resource) => ({
      resourceId: resource.id,
      starts: freeSlotStarts({
        day: prepared.day,
        timeZone,
        windows: windows.get(resource.id) ?? [],
        service,
        busy: busy
          .filter((row) => row.resourceId === resource.id)
          .map((row) => ({ from: row.blockedFrom, until: row.blockedUntil })),
        slotMinutes: settings.slotMinutes,
        // One minute back: `freeSlotStarts` offers what is AFTER its clock, and a start exactly at the earliest is allowed.
        now: earliest ? addMinutes(earliest, -1) : now,
      }),
    }));
  }

  /** The workspace's settings, or the defaults when it has set none. */
  async settings(scope: BookingScope): Promise<BookingSettingsValues> {
    return (await this.settingsRead(scope)).settings;
  }

  /** The settings with the public page's address. */
  async settingsRead(scope: BookingScope): Promise<BookingSettingsRead> {
    const row = await this.prisma.bookingSettings.findUnique({ where: { workspaceId: scope.workspaceId } });
    // ⚠ A row found by workspace alone: one from another organization is not this workspace's.
    const own = row && row.organizationId === scope.organizationId ? row : null;
    return { settings: normalizeBookingSettings(own), publicLinkId: own?.publicLinkId ?? null };
  }

  /**
   * Every request WAITING for staff in the workspace, whatever day it is for,
   * the longest-waiting first — so one for next week is not forgotten because
   * nobody opened next week (BOOKING-PLAN §8).
   */
  async requests(scope: BookingScope): Promise<BookingAppointmentRow[]> {
    return this.prisma.bookingAppointment.findMany({
      where: { ...scope, status: 'pending' },
      orderBy: [{ pendingSince: 'asc' }, { id: 'asc' }],
      take: BOOKING_REQUESTS_READ_MAX,
    });
  }

  /** Who a staff resource may be linked to. Unbound directory: nobody. */
  async members(scope: BookingScope): Promise<readonly BookingMember[]> {
    if (!this.directory) return [];
    return this.directory.listDesk(scope.organizationId, scope.workspaceId);
  }

  /** Display names for these ids. Unknown ids — and every id when unbound — are left out. */
  async memberNames(userIds: readonly (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds.filter((id): id is string => id !== null))];
    if (!this.directory || unique.length === 0) return new Map();
    const members = await this.directory.describe(unique);
    return new Map(members.map((member) => [member.userId, member.displayName]));
  }

  /**
   * The names a page of bookings shows: each one's service and resource — found
   * by id AND scope, archived ones included, since an old booking still names
   * them — and the members who made them.
   */
  async namesFor(
    scope: BookingScope,
    appointments: readonly BookingAppointmentRow[],
    changes: readonly BookingChangeRow[] = [],
  ): Promise<BookingNames> {
    const serviceIds = [...new Set(appointments.map((row) => row.serviceId))];
    const resourceIds = [
      ...new Set([
        ...appointments.map((row) => row.resourceId),
        ...changes.flatMap((change) => [change.fromResourceId, change.toResourceId]),
      ]),
    ].filter((id): id is string => id !== null);
    const [services, resources, members] = await Promise.all([
      serviceIds.length === 0
        ? Promise.resolve([])
        : this.prisma.bookingService.findMany({
            where: { ...scope, id: { in: serviceIds } },
            orderBy: [{ id: 'asc' }],
            take: serviceIds.length,
          }),
      resourceIds.length === 0
        ? Promise.resolve([])
        : this.prisma.bookingResource.findMany({
            where: { ...scope, id: { in: resourceIds } },
            orderBy: [{ id: 'asc' }],
            take: resourceIds.length,
          }),
      this.memberNames([...appointments.map((row) => row.createdById), ...changes.map((change) => change.actorId)]),
    ]);
    return {
      services: new Map(services.map((service) => [service.id, service.name])),
      resources: new Map(resources.map((resource) => [resource.id, resource.name])),
      members,
    };
  }
}
