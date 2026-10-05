/**
 * Every GraphQL document this module sends, as data.
 *
 * A document is the ONE part of a typed client that nothing typechecks: a
 * renamed field or a moved argument is a runtime refusal on a screen. Lifted out
 * here, the host hands every one of them to `graphql`'s own validator against
 * the schema it serves — `apps/web-server/test/module-operations.test.ts`.
 *
 * ⚠ FRAMEWORK-FREE, and exported from the package ROOT rather than `/react`, so
 * a server validating them never resolves React to read a string.
 */

const SERVICE = 'id name durationMinutes bufferBeforeMinutes bufferAfterMinutes price resourceIds archivedAt';
const RESOURCE = 'id name kind userId userName hours { weekday startMinute endMinute } archivedAt';
const EXCEPTION = 'id resourceId day startMinute endMinute note';
const APPOINTMENT =
  'id serviceId serviceName resourceId resourceName startsAt endsAt status customerName customerPhone customerEmail note createdById createdByName createdAt updatedAt';
const CHANGE =
  'id kind actorKind actorId actorName fromStartsAt toStartsAt fromResourceName toResourceName reason createdAt';
const SETTINGS =
  'slotMinutes reminderMinutes publicEnabled publicLinkId publicTitle publicNote leadMinutes horizonDays cutoffMinutes lapseHours';
const PUBLIC_BOOKING =
  'title note timeZone today lastDay cutoffMinutes serviceId serviceName resourceId resourceName startsAt endsAt status customerName reason canChange';
const SCOPE_VARS = '$organizationId: String!, $workspaceId: String!';
const SCOPE_ARGS = 'organizationId: $organizationId, workspaceId: $workspaceId';

export const BOOKING_OPERATIONS = {
  // ── what can be booked ────────────────────────────────────────────────────

  /** Services and resources in one read: every screen needs both to name a booking. */
  bookingCatalogue: `query BookingCatalogue(${SCOPE_VARS}, $includeArchived: Boolean) {
    bookingCatalogue(${SCOPE_ARGS}, includeArchived: $includeArchived) {
      services { ${SERVICE} }
      resources { ${RESOURCE} }
    }
  }`,

  /** Closed days and stretches from `fromDay` on, the workspace-wide ones included. */
  bookingExceptions: `query BookingExceptions(${SCOPE_VARS}, $fromDay: String!) {
    bookingExceptions(${SCOPE_ARGS}, fromDay: $fromDay) { ${EXCEPTION} }
  }`,

  /** Who a staff resource may be linked to. */
  bookingMembers: `query BookingMembers(${SCOPE_VARS}) {
    bookingMembers(${SCOPE_ARGS}) { userId displayName }
  }`,

  bookingSettings: `query BookingSettings(${SCOPE_VARS}) {
    bookingSettings(${SCOPE_ARGS}) { ${SETTINGS} }
  }`,

  saveBookingService: `mutation SaveBookingService(${SCOPE_VARS}, $serviceId: String, $input: BookingServiceInput!) {
    saveBookingService(${SCOPE_ARGS}, serviceId: $serviceId, input: $input) { ${SERVICE} }
  }`,

  setBookingServiceArchived: `mutation SetBookingServiceArchived(${SCOPE_VARS}, $serviceId: String!, $archived: Boolean!) {
    setBookingServiceArchived(${SCOPE_ARGS}, serviceId: $serviceId, archived: $archived) { ${SERVICE} }
  }`,

  saveBookingResource: `mutation SaveBookingResource(${SCOPE_VARS}, $resourceId: String, $input: BookingResourceInput!) {
    saveBookingResource(${SCOPE_ARGS}, resourceId: $resourceId, input: $input) { ${RESOURCE} }
  }`,

  setBookingResourceArchived: `mutation SetBookingResourceArchived(${SCOPE_VARS}, $resourceId: String!, $archived: Boolean!) {
    setBookingResourceArchived(${SCOPE_ARGS}, resourceId: $resourceId, archived: $archived) { ${RESOURCE} }
  }`,

  /** The resource's WHOLE week, replacing what was there. */
  setBookingResourceHours: `mutation SetBookingResourceHours(${SCOPE_VARS}, $resourceId: String!, $hours: [BookingHoursWindowInput!]!) {
    setBookingResourceHours(${SCOPE_ARGS}, resourceId: $resourceId, hours: $hours) { ${RESOURCE} }
  }`,

  addBookingException: `mutation AddBookingException(${SCOPE_VARS}, $input: BookingExceptionInput!) {
    addBookingException(${SCOPE_ARGS}, input: $input) { ${EXCEPTION} }
  }`,

  removeBookingException: `mutation RemoveBookingException(${SCOPE_VARS}, $exceptionId: String!) {
    removeBookingException(${SCOPE_ARGS}, exceptionId: $exceptionId)
  }`,

  saveBookingSettings: `mutation SaveBookingSettings(${SCOPE_VARS}, $input: BookingSettingsInput!) {
    saveBookingSettings(${SCOPE_ARGS}, input: $input) { ${SETTINGS} }
  }`,

  /** Replaces the public page's address. The old one stops working at once. */
  resetBookingPublicLink: `mutation ResetBookingPublicLink(${SCOPE_VARS}) {
    resetBookingPublicLink(${SCOPE_ARGS}) { ${SETTINGS} }
  }`,

  // ── the day ───────────────────────────────────────────────────────────────

  /** One WORKSPACE day's bookings, in order, whatever their status. */
  bookingDay: `query BookingDay(${SCOPE_VARS}, $day: String!) {
    bookingDay(${SCOPE_ARGS}, day: $day) { day timeZone truncated appointments { ${APPOINTMENT} } }
  }`,

  /** Every request waiting for staff, whatever day it is for, the longest-waiting first. */
  bookingRequests: `query BookingRequests(${SCOPE_VARS}) {
    bookingRequests(${SCOPE_ARGS}) { ${APPOINTMENT} }
  }`,

  /** Null for a booking that does not exist and for one in another workspace alike. */
  bookingAppointment: `query BookingAppointment(${SCOPE_VARS}, $appointmentId: String!) {
    bookingAppointment(${SCOPE_ARGS}, appointmentId: $appointmentId) { ${APPOINTMENT} changes { ${CHANGE} } }
  }`,

  /** The free starts on one day, per resource that can perform the service. */
  bookingSlots: `query BookingSlots(${SCOPE_VARS}, $serviceId: String!, $day: String!, $forAppointmentId: String) {
    bookingSlots(${SCOPE_ARGS}, serviceId: $serviceId, day: $day, forAppointmentId: $forAppointmentId) {
      resourceId
      starts
    }
  }`,

  // ── bookings ──────────────────────────────────────────────────────────────

  createBookingAppointment: `mutation CreateBookingAppointment(${SCOPE_VARS}, $input: BookingAppointmentInput!) {
    createBookingAppointment(${SCOPE_ARGS}, input: $input) { ${APPOINTMENT} }
  }`,

  rescheduleBookingAppointment: `mutation RescheduleBookingAppointment(${SCOPE_VARS}, $appointmentId: String!, $startsAt: String!, $resourceId: String!) {
    rescheduleBookingAppointment(${SCOPE_ARGS}, appointmentId: $appointmentId, startsAt: $startsAt, resourceId: $resourceId) { ${APPOINTMENT} }
  }`,

  updateBookingAppointmentDetails: `mutation UpdateBookingAppointmentDetails(${SCOPE_VARS}, $appointmentId: String!, $input: BookingAppointmentDetailsInput!) {
    updateBookingAppointmentDetails(${SCOPE_ARGS}, appointmentId: $appointmentId, input: $input) { ${APPOINTMENT} }
  }`,

  confirmBookingAppointment: `mutation ConfirmBookingAppointment(${SCOPE_VARS}, $appointmentId: String!) {
    confirmBookingAppointment(${SCOPE_ARGS}, appointmentId: $appointmentId) { ${APPOINTMENT} }
  }`,

  declineBookingAppointment: `mutation DeclineBookingAppointment(${SCOPE_VARS}, $appointmentId: String!, $reason: String) {
    declineBookingAppointment(${SCOPE_ARGS}, appointmentId: $appointmentId, reason: $reason) { ${APPOINTMENT} }
  }`,

  /** `status` is `arrived`, `done` or `no_show`. */
  markBookingAppointment: `mutation MarkBookingAppointment(${SCOPE_VARS}, $appointmentId: String!, $status: String!) {
    markBookingAppointment(${SCOPE_ARGS}, appointmentId: $appointmentId, status: $status) { ${APPOINTMENT} }
  }`,

  cancelBookingAppointment: `mutation CancelBookingAppointment(${SCOPE_VARS}, $appointmentId: String!, $reason: String!) {
    cancelBookingAppointment(${SCOPE_ARGS}, appointmentId: $appointmentId, reason: $reason) { ${APPOINTMENT} }
  }`,

  // ── the public page (no session: the link id, or the manage token, is all there is) ──

  /** Null for a link that does not exist and for a page that is turned off alike. */
  publicBookingPage: `query PublicBookingPage($linkId: String!) {
    publicBookingPage(linkId: $linkId) {
      title note timeZone today lastDay cutoffMinutes
      services { id name durationMinutes price }
    }
  }`,

  publicBookingSlots: `query PublicBookingSlots($linkId: String!, $serviceId: String!, $day: String!) {
    publicBookingSlots(linkId: $linkId, serviceId: $serviceId, day: $day) { resourceId resourceName starts }
  }`,

  /** ⚠ `manageToken` is sent this once and never again. */
  requestPublicBooking: `mutation RequestPublicBooking($linkId: String!, $input: BookingPublicRequestInput!) {
    requestPublicBooking(linkId: $linkId, input: $input) { manageToken booking { ${PUBLIC_BOOKING} } }
  }`,

  /** Null for a token nobody was given. */
  publicBooking: `query PublicBooking($token: String!) {
    publicBooking(token: $token) { ${PUBLIC_BOOKING} }
  }`,

  publicBookingMoveSlots: `query PublicBookingMoveSlots($token: String!, $day: String!) {
    publicBookingMoveSlots(token: $token, day: $day) { resourceId resourceName starts }
  }`,

  cancelPublicBooking: `mutation CancelPublicBooking($token: String!, $reason: String) {
    cancelPublicBooking(token: $token, reason: $reason) { ${PUBLIC_BOOKING} }
  }`,

  reschedulePublicBooking: `mutation ReschedulePublicBooking($token: String!, $startsAt: String!, $resourceId: String!) {
    reschedulePublicBooking(token: $token, startsAt: $startsAt, resourceId: $resourceId) { ${PUBLIC_BOOKING} }
  }`,

  // ── live ──────────────────────────────────────────────────────────────────

  /**
   * "Something changed": ids and a kind, never a customer's name. `sync` first,
   * and after every reconnect; the client reads again through the guarded
   * queries.
   */
  bookingEvents: `subscription BookingEvents(${SCOPE_VARS}) {
    bookingEvents(${SCOPE_ARGS}) { kind appointmentId actorId }
  }`,
} as const;

export type BookingOperationName = keyof typeof BOOKING_OPERATIONS;
