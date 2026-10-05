import { openWindows } from '../domain/hours.js';
import { type BookingDay, bookingDayToDate, bookingWeekday } from '../domain/time.js';
import type { BookingMinuteRange } from '../types.js';
import { bookingNotFound } from './booking.errors.js';
import type {
  BookingAppointmentRow,
  BookingResourceRow,
  BookingServiceRow,
  BookingTransaction,
  InScope,
} from './booking.repository.js';

/**
 * Finding a service, resource or booking the way EVERY service must: by id AND
 * scope, with ONE answer for "no such thing" and "in another workspace".
 *
 * In one file so there is one way to do it. A service that looked a booking up
 * by id alone would read a customer's name from any tenant.
 */

export type BookingScope = InScope;

/** How many closed days and stretches one day can carry before the rest are not read. Far more than a day has. */
const EXCEPTIONS_PER_DAY_MAX = 200;

export async function loadService(
  client: Pick<BookingTransaction, 'bookingService'>,
  scope: BookingScope,
  serviceId: string,
): Promise<BookingServiceRow> {
  const service = await client.bookingService.findFirst({ where: { ...scope, id: serviceId } });
  if (!service) throw bookingNotFound();
  return service;
}

export async function loadResource(
  client: Pick<BookingTransaction, 'bookingResource'>,
  scope: BookingScope,
  resourceId: string,
): Promise<BookingResourceRow> {
  const resource = await client.bookingResource.findFirst({ where: { ...scope, id: resourceId } });
  if (!resource) throw bookingNotFound();
  return resource;
}

export async function loadAppointment(
  client: Pick<BookingTransaction, 'bookingAppointment'>,
  scope: BookingScope,
  appointmentId: string,
): Promise<BookingAppointmentRow> {
  const appointment = await client.bookingAppointment.findFirst({ where: { ...scope, id: appointmentId } });
  if (!appointment) throw bookingNotFound();
  return appointment;
}

/**
 * The stretches each of these resources is open on ONE workspace day: its
 * weekly hours, minus its own closures and the workspace-wide ones.
 *
 * ⚠ THE ONE PLACE availability is read, for the slot list AND for the check a
 * write makes — so what is offered and what is accepted cannot disagree.
 */
export async function openWindowsOn(
  client: Pick<BookingTransaction, 'bookingHours' | 'bookingException'>,
  scope: BookingScope,
  resourceIds: readonly string[],
  day: BookingDay,
): Promise<Map<string, BookingMinuteRange[]>> {
  const windows = new Map<string, BookingMinuteRange[]>();
  const weekday = bookingWeekday(day);
  if (weekday === null || resourceIds.length === 0) return windows;

  const [hours, exceptions] = await Promise.all([
    client.bookingHours.findMany({
      where: { resourceId: { in: [...resourceIds] } },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    }),
    client.bookingException.findMany({
      where: { ...scope, day: bookingDayToDate(day) },
      orderBy: [{ day: 'asc' }, { id: 'asc' }],
      take: EXCEPTIONS_PER_DAY_MAX,
    }),
  ]);

  for (const resourceId of resourceIds) {
    const own = hours.filter((row) => row.resourceId === resourceId);
    // A closure naming no resource closes every one of them.
    const closures = exceptions.filter((row) => row.resourceId === null || row.resourceId === resourceId);
    windows.set(resourceId, openWindows(own, weekday, closures));
  }
  return windows;
}
