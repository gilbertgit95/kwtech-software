/**
 * Injection tokens, in their own file so nothing has to import a Nest module to
 * name one. Strings rather than symbols, matching every module here.
 */

/** The READ client. Host-injected; this module opens no connection. */
export const BOOKING_PRISMA = 'kwtech:booking-prisma';

/**
 * The WRITE client, which must expose `$transaction`. Separate from the read
 * one because a host may point reads at a replica, and a service that took one
 * client would silently write to it.
 */
export const BOOKING_PRISMA_WRITE = 'kwtech:booking-prisma-write';

export const BOOKING_OPTIONS = 'kwtech:booking-options';

/**
 * The module-kit `LimitChecker`. ⚠ Unbound means the DECLARED DEFAULT cap, not
 * module-kit's `NULL_LIMIT_CHECKER` (which allows everything): an unset cap is a
 * floor, never unlimited.
 */
export const BOOKING_LIMIT_CHECKER = 'kwtech:booking-limit-checker';

/** A `BookingWorkspaceTimeZone`. Unbound means `DEFAULT_TIME_ZONE` (Asia/Manila), never UTC. */
export const BOOKING_WORKSPACE_TIME_ZONE = 'kwtech:booking-workspace-time-zone';

/**
 * A `BookingMemberDirectory`. Unbound means nobody has a name, no member can be
 * linked to a staff resource, and — since nobody can be shown to work the desk
 * — no reminder is sent.
 */
export const BOOKING_MEMBER_DIRECTORY = 'kwtech:booking-member-directory';

/** A `BookingNotifier`. Unbound means nobody is told — bookings still work. */
export const BOOKING_NOTIFIER = 'kwtech:booking-notifier';

/**
 * The pub/sub engine. Unbound means NOT LIVE: every write still works, and the
 * app only sees other people's changes when it reads again.
 *
 * ⚠ Bind the app's OWN engine, never a fresh one: two engines in one process do
 * not see each other's publishes.
 */
export const BOOKING_PUBSUB = 'kwtech:booking-pubsub';
