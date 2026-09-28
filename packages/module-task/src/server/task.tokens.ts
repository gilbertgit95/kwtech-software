/**
 * Injection tokens, in their own file so nothing has to import a Nest module to
 * name one. Strings rather than symbols, matching every module here.
 */

/** The READ client. Host-injected; this module opens no connection. */
export const TASK_PRISMA = 'kwtech:task-prisma';

/**
 * The WRITE client, which must expose `$transaction`. Separate from the read
 * one because a host may point reads at a replica, and a service that took one
 * client would silently write to it.
 */
export const TASK_PRISMA_WRITE = 'kwtech:task-prisma-write';

export const TASK_OPTIONS = 'kwtech:task-options';

/**
 * The module-kit `LimitChecker`. ⚠ Unbound means the DECLARED DEFAULT caps, not
 * module-kit's `NULL_LIMIT_CHECKER` (which allows everything): an unset cap is a
 * floor, never unlimited.
 */
export const TASK_LIMIT_CHECKER = 'kwtech:task-limit-checker';

/** A `TaskAccessCheck`. Unbound means nobody holds `task:assign` or `task:manage_all`. */
export const TASK_ACCESS_CHECK = 'kwtech:task-access-check';

/** A `TaskMemberDirectory`. Unbound means you can assign only yourself, and nobody has a name. */
export const TASK_MEMBER_DIRECTORY = 'kwtech:task-member-directory';

/** A `TaskNotifier`. Unbound means nobody is told — tasks still work. */
export const TASK_NOTIFIER = 'kwtech:task-notifier';

/**
 * The pub/sub engine. Unbound means NOT LIVE: every write still works, and the
 * app only sees other people's changes when it reads again.
 *
 * ⚠ Bind the app's OWN engine, never a fresh one: two engines in one process do
 * not see each other's publishes.
 */
export const TASK_PUBSUB = 'kwtech:task-pubsub';
