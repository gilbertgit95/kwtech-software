/**
 * Injection tokens, in their own file so nothing has to import a Nest module to
 * name one. Strings rather than symbols, matching every module here.
 */

/** The READ client. Host-injected; this module opens no connection. */
export const STUDIO_PRISMA = 'kwtech:studio-prisma';

/**
 * The WRITE client, which must expose `$transaction`. Separate from the read
 * one because they are different capabilities: a host may point reads at a
 * replica, and a service that took one client would silently write to it.
 */
export const STUDIO_PRISMA_WRITE = 'kwtech:studio-prisma-write';

export const STUDIO_OPTIONS = 'kwtech:studio-options';

/**
 * The module-kit `LimitChecker`. ⚠ Unbound means the DECLARED DEFAULT cap, not
 * module-kit's `NULL_LIMIT_CHECKER` (which allows everything): an unset cap is a
 * floor, never unlimited.
 */
export const STUDIO_LIMIT_CHECKER = 'kwtech:studio-limit-checker';

/**
 * A `StudioAccessCheck`. Unbound means NO: you change your own layouts only,
 * and you read your own print history only.
 */
export const STUDIO_ACCESS_CHECK = 'kwtech:studio-access-check';

/** A `StudioMemberDirectory`. Unbound means nobody has a name: "a member". */
export const STUDIO_MEMBER_DIRECTORY = 'kwtech:studio-member-directory';
