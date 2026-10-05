/**
 * The questions this module needs answered and cannot answer itself.
 *
 * The workspace's zone and its members belong to `module-permissions`, names
 * to `module-auth`, and telling people things to `module-notification` — and a
 * module may not import a module (PLAN §9). So each is a structural port the
 * APP fills, and each absence has a documented MEANING rather than a crash.
 *
 * The ports the plan names for later are NOT declared yet (BOOKING-PLAN §7):
 * the customer directory and messenger, the queue check-in and the POS
 * hand-off. A port nothing calls is a promise nothing keeps.
 *
 * ⚠ The public page needs NO port of its own. What a customer sees of the shop
 * — its name, a note — is what the shop typed into booking's own settings, so
 * nothing about the workspace is read from another module to show a stranger.
 */

/**
 * The workspace's IANA time zone (`perm_workspace.timeZone`): what 9:00 means
 * there, and which day a booking belongs to. Null when the app cannot say.
 *
 * UNBOUND MEANS `DEFAULT_TIME_ZONE` (Asia/Manila), never UTC — which would open
 * every shop eight hours late and move every evening booking to the next day.
 */
export interface BookingWorkspaceTimeZone {
  timeZoneOf(organizationId: string, workspaceId: string): Promise<string | null>;
}

export interface BookingMember {
  userId: string;
  displayName: string;
}

/**
 * Who works the bookings here, and names.
 *
 * `listDesk` is ACTIVE members of the workspace who hold
 * `booking:manage_appointments` there. It answers two things: who a staff
 * resource may be linked to, and who is told that a booking is about to start.
 * `describe` names anybody, former members included; an id it does not know is
 * left out, and the app says "a former member".
 *
 * ⚠ UNBOUND MEANS NOBODY: no names, no member can be linked to a resource, and
 * no reminder reaches anyone. Fail closed.
 */
export interface BookingMemberDirectory {
  listDesk(organizationId: string, workspaceId: string): Promise<readonly BookingMember[]>;
  describe(userIds: readonly string[]): Promise<readonly BookingMember[]>;
}

/**
 * Telling staff about bookings. Speaks the MODULE's language — a booking is
 * about to start — and the app chooses the words, the severity and the source
 * (`module-notification`'s recipe).
 *
 * ⚠ STAFF ONLY. Nothing here reaches a customer: that is a different port, for
 * when the operator has an e-mail provider (BOOKING-PLAN D3, PLAN §12.91).
 *
 * ⚠ CALLED AFTER ITS ROW IS WRITTEN, never inside a transaction, and its
 * failure never fails a run.
 *
 * UNBOUND MEANS NOBODY IS TOLD. Bookings still work.
 */
export interface BookingNotifier {
  /** Said by the `booking.upcoming_sessions` process, not by a person, so there is no actor. */
  startingSoon(event: BookingStartingSoonNotice): Promise<void>;
  /** A customer asked for a booking on the public page: it is waiting to be confirmed (D2). */
  requestWaiting(event: BookingCustomerNotice): Promise<void>;
  /** A customer cancelled their booking on their manage link. */
  customerCancelled(event: BookingCustomerNotice): Promise<void>;
  /** A customer moved their booking, which is waiting to be confirmed again (D8). `startsAt` is the NEW time. */
  customerRescheduled(event: BookingCustomerNotice): Promise<void>;
}

/** Something a CUSTOMER did, told to the desk. The same facts as a reminder: who, what, when, with whom. */
export type BookingCustomerNotice = BookingStartingSoonNotice;

export interface BookingStartingSoonNotice {
  recipientIds: readonly string[];
  organizationId: string;
  workspaceId: string;
  appointmentId: string;
  /** An ISO instant. The app prints it in `timeZone`. */
  startsAt: string;
  /** The workspace's zone, so "at 2:30 PM" is the shop's 2:30 and not the server's. */
  timeZone: string;
  serviceName: string;
  resourceName: string;
  customerName: string;
}
