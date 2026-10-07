/**
 * Injection tokens, in their own file so nothing has to import a Nest module to
 * name one. Strings rather than symbols, matching every module here.
 */

/** The READ client. Host-injected; this module opens no connection. */
export const PRINT_PRISMA = 'kwtech:print-prisma';

/**
 * The WRITE client, which must expose `$transaction`. Separate from the read
 * one because they are different capabilities: a host may point reads at a
 * replica, and a service that took one client would silently write to it.
 */
export const PRINT_PRISMA_WRITE = 'kwtech:print-prisma-write';

export const PRINT_OPTIONS = 'kwtech:print-options';

/**
 * The module-kit `LimitChecker`. ⚠ Unbound means the DECLARED DEFAULT cap, not
 * module-kit's `NULL_LIMIT_CHECKER` (which allows everything): an unset cap is a
 * floor, never unlimited.
 */
export const PRINT_LIMIT_CHECKER = 'kwtech:print-limit-checker';
