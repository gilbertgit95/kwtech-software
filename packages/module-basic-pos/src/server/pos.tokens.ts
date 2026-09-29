/**
 * Injection tokens, in their own file so nothing has to import a Nest module to
 * name one. Strings rather than symbols, matching every module here.
 */

/** The READ client. Host-injected; this module opens no connection. */
export const POS_PRISMA = 'kwtech:pos-prisma';

/**
 * The WRITE client, which must expose `$transaction`. Separate from the read
 * one because a host may point reads at a replica, and a service that took one
 * client would silently write to it.
 */
export const POS_PRISMA_WRITE = 'kwtech:pos-prisma-write';

export const POS_OPTIONS = 'kwtech:pos-options';

/**
 * The module-kit `LimitChecker`. ⚠ Unbound means the DECLARED DEFAULT cap, not
 * module-kit's `NULL_LIMIT_CHECKER` (which allows everything): an unset cap is a
 * floor, never unlimited.
 */
export const POS_LIMIT_CHECKER = 'kwtech:pos-limit-checker';

/**
 * A `PosAccessCheck`. ⚠ Unbound means NOBODY holds any key beyond what the
 * guard already checked: costs are never shown, and an edit by anybody drops
 * fixed discounts. Fail closed.
 */
export const POS_ACCESS_CHECK = 'kwtech:pos-access-check';

/** A `PosMemberDirectory`. Unbound means nobody has a name: reports show "a team member". */
export const POS_MEMBER_DIRECTORY = 'kwtech:pos-member-directory';

/**
 * The pub/sub engine. Unbound means NOT LIVE: every write still works, and a
 * till only sees another till's change when it reads again.
 *
 * ⚠ Bind the app's OWN engine, never a fresh one: two engines in one process do
 * not see each other's publishes.
 */
export const POS_PUBSUB = 'kwtech:pos-pubsub';
