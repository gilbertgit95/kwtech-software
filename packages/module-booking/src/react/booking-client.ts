'use client';

import { BOOKING_OPERATIONS, type BookingOperationName } from '../operations.js';
import type { PublicBookingOperation } from './booking-public-client.js';

/**
 * How the booking app reaches the API — through the app's same-origin route
 * handler, which attaches the session. The path is a parameter because that
 * handler belongs to `module-auth`, and this module may not name its URL
 * (PLAN §9). The default is where this app mounts it.
 */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

export interface BookingScopeView {
  organizationId: string;
  workspaceId: string;
}

export interface BookingServiceView {
  id: string;
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  /** Centavos. Null: no price shown. */
  price: number | null;
  resourceIds: string[];
  archivedAt: string | null;
}

export interface BookingHoursWindowView {
  /** 0 is Sunday. */
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface BookingResourceView {
  id: string;
  name: string;
  /** `staff`, `place` or `equipment`. */
  kind: string;
  userId: string | null;
  userName: string | null;
  hours: BookingHoursWindowView[];
  archivedAt: string | null;
}

export interface BookingCatalogueView {
  services: BookingServiceView[];
  resources: BookingResourceView[];
}

export interface BookingExceptionView {
  id: string;
  /** Null: every resource. */
  resourceId: string | null;
  /** `YYYY-MM-DD`. */
  day: string;
  /** Null with `endMinute`: the whole day. */
  startMinute: number | null;
  endMinute: number | null;
  note: string;
}

export interface BookingPersonView {
  userId: string;
  displayName: string;
}

export interface BookingSettingsView {
  slotMinutes: number;
  /** 0: no reminder. */
  reminderMinutes: number;
  /** Whether customers can book on the public page. */
  publicEnabled: boolean;
  /** The public page is at `/book/<publicLinkId>`. Null until it has been turned on once. */
  publicLinkId: string | null;
  publicTitle: string;
  publicNote: string;
  leadMinutes: number;
  horizonDays: number;
  cutoffMinutes: number;
  lapseHours: number;
}

/** Some settings to change. Only what is given changes; the link is the server's to make. */
export type BookingSettingsPatch = Partial<Omit<BookingSettingsView, 'publicLinkId'>>;

export interface BookingAppointmentView {
  id: string;
  serviceId: string;
  serviceName: string;
  resourceId: string;
  resourceName: string;
  /** ISO instants. Print them in the workspace's zone. */
  startsAt: string;
  endsAt: string;
  status: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  note: string;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingChangeView {
  id: string;
  kind: string;
  /** `staff` or `customer`. */
  actorKind: string;
  actorId: string | null;
  actorName: string | null;
  fromStartsAt: string | null;
  toStartsAt: string | null;
  fromResourceName: string | null;
  toResourceName: string | null;
  reason: string;
  createdAt: string;
}

export interface BookingAppointmentDetailView extends BookingAppointmentView {
  changes: BookingChangeView[];
}

export interface BookingDayView {
  day: string;
  timeZone: string;
  appointments: BookingAppointmentView[];
  truncated: boolean;
}

export interface BookingResourceSlotsView {
  resourceId: string;
  /** ISO instants, in order. */
  starts: string[];
}

/** `sync`, `appointment`, `catalogue` or `settings`. */
export interface BookingEventView {
  kind: string;
  appointmentId: string | null;
  actorId: string | null;
}

export interface BookingServiceInput {
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  price: number | null;
  resourceIds: string[];
}

export interface BookingResourceInput {
  name: string;
  kind: string;
  userId: string | null;
}

export interface BookingExceptionInput {
  resourceId: string | null;
  day: string;
  startMinute: number | null;
  endMinute: number | null;
  note: string;
}

export interface BookingDetailsInput {
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  note: string;
}

export interface BookingAppointmentInput extends BookingDetailsInput {
  serviceId: string;
  resourceId: string;
  startsAt: string;
}

/** The documents staff send: everything but the live stream and the customer's own (`booking-public-client.ts`). */
type StaffOperation = Exclude<BookingOperationName, 'bookingEvents' | PublicBookingOperation>;

/** One method per operation. Every error is a sentence for a person. */
export interface BookingClient {
  catalogue(scope: BookingScopeView, includeArchived?: boolean): Promise<BookingCatalogueView>;
  exceptions(scope: BookingScopeView, fromDay: string): Promise<BookingExceptionView[]>;
  members(scope: BookingScopeView): Promise<BookingPersonView[]>;
  settings(scope: BookingScopeView): Promise<BookingSettingsView>;
  saveService(
    scope: BookingScopeView,
    serviceId: string | null,
    input: BookingServiceInput,
  ): Promise<BookingServiceView>;
  setServiceArchived(scope: BookingScopeView, serviceId: string, archived: boolean): Promise<BookingServiceView>;
  saveResource(
    scope: BookingScopeView,
    resourceId: string | null,
    input: BookingResourceInput,
  ): Promise<BookingResourceView>;
  setResourceArchived(scope: BookingScopeView, resourceId: string, archived: boolean): Promise<BookingResourceView>;
  setResourceHours(
    scope: BookingScopeView,
    resourceId: string,
    hours: BookingHoursWindowView[],
  ): Promise<BookingResourceView>;
  addException(scope: BookingScopeView, input: BookingExceptionInput): Promise<BookingExceptionView>;
  removeException(scope: BookingScopeView, exceptionId: string): Promise<boolean>;
  saveSettings(scope: BookingScopeView, input: BookingSettingsPatch): Promise<BookingSettingsView>;
  /** Replaces the public page's address. The old one stops working at once. */
  resetPublicLink(scope: BookingScopeView): Promise<BookingSettingsView>;
  /** Every request waiting for staff, whatever day it is for, the longest-waiting first. */
  requests(scope: BookingScopeView): Promise<BookingAppointmentView[]>;

  day(scope: BookingScopeView, day: string): Promise<BookingDayView>;
  appointment(scope: BookingScopeView, appointmentId: string): Promise<BookingAppointmentDetailView | null>;
  /** `forAppointmentId`: the booking being moved, whose own time must not block it. */
  slots(
    scope: BookingScopeView,
    serviceId: string,
    day: string,
    forAppointmentId?: string | null,
  ): Promise<BookingResourceSlotsView[]>;
  create(scope: BookingScopeView, input: BookingAppointmentInput): Promise<BookingAppointmentView>;
  reschedule(
    scope: BookingScopeView,
    appointmentId: string,
    startsAt: string,
    resourceId: string,
  ): Promise<BookingAppointmentView>;
  updateDetails(
    scope: BookingScopeView,
    appointmentId: string,
    input: BookingDetailsInput,
  ): Promise<BookingAppointmentView>;
  confirm(scope: BookingScopeView, appointmentId: string): Promise<BookingAppointmentView>;
  decline(scope: BookingScopeView, appointmentId: string, reason: string | null): Promise<BookingAppointmentView>;
  mark(
    scope: BookingScopeView,
    appointmentId: string,
    status: 'arrived' | 'done' | 'no_show',
  ): Promise<BookingAppointmentView>;
  cancel(scope: BookingScopeView, appointmentId: string, reason: string): Promise<BookingAppointmentView>;
}

export function createBookingClient(options: { graphqlPath?: string } = {}): BookingClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;

  /**
   * One request shape for every call, answering the operation's own field.
   * Throws the API's FIRST error message: the refusals are written for a
   * reader, and one — the time that was just taken — is what the form compares
   * against.
   */
  async function call<T>(
    operation: StaffOperation,
    scope: BookingScopeView,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          query: BOOKING_OPERATIONS[operation],
          variables: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, ...variables },
        }),
        cache: 'no-store',
      });
    } catch {
      // ⚠ Say that NOTHING was saved: somebody at a desk must not tell a customer they are booked.
      throw new Error('Cannot reach the server — nothing was saved. Check the connection and try again.');
    }
    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Your session has ended. Sign in again.' : 'Cannot reach the server.');
    }
    const body = (await response.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'The request was refused.');
    if (!body.data || !(operation in body.data)) throw new Error('The server returned no data.');
    return body.data[operation] as T;
  }

  return {
    catalogue: (scope, includeArchived = false) => call('bookingCatalogue', scope, { includeArchived }),
    exceptions: (scope, fromDay) => call('bookingExceptions', scope, { fromDay }),
    members: (scope) => call('bookingMembers', scope),
    settings: (scope) => call('bookingSettings', scope),
    saveService: (scope, serviceId, input) => call('saveBookingService', scope, { serviceId, input }),
    setServiceArchived: (scope, serviceId, archived) =>
      call('setBookingServiceArchived', scope, { serviceId, archived }),
    saveResource: (scope, resourceId, input) => call('saveBookingResource', scope, { resourceId, input }),
    setResourceArchived: (scope, resourceId, archived) =>
      call('setBookingResourceArchived', scope, { resourceId, archived }),
    setResourceHours: (scope, resourceId, hours) => call('setBookingResourceHours', scope, { resourceId, hours }),
    addException: (scope, input) => call('addBookingException', scope, { input }),
    removeException: (scope, exceptionId) => call('removeBookingException', scope, { exceptionId }),
    saveSettings: (scope, input) => call('saveBookingSettings', scope, { input }),
    resetPublicLink: (scope) => call('resetBookingPublicLink', scope),
    requests: (scope) => call('bookingRequests', scope),

    day: (scope, day) => call('bookingDay', scope, { day }),
    appointment: (scope, appointmentId) => call('bookingAppointment', scope, { appointmentId }),
    slots: (scope, serviceId, day, forAppointmentId = null) =>
      call('bookingSlots', scope, { serviceId, day, forAppointmentId }),
    create: (scope, input) => call('createBookingAppointment', scope, { input }),
    reschedule: (scope, appointmentId, startsAt, resourceId) =>
      call('rescheduleBookingAppointment', scope, { appointmentId, startsAt, resourceId }),
    updateDetails: (scope, appointmentId, input) =>
      call('updateBookingAppointmentDetails', scope, { appointmentId, input }),
    confirm: (scope, appointmentId) => call('confirmBookingAppointment', scope, { appointmentId }),
    decline: (scope, appointmentId, reason) => call('declineBookingAppointment', scope, { appointmentId, reason }),
    mark: (scope, appointmentId, status) => call('markBookingAppointment', scope, { appointmentId, status }),
    cancel: (scope, appointmentId, reason) => call('cancelBookingAppointment', scope, { appointmentId, reason }),
  };
}
