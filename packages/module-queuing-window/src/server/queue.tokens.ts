/**
 * Injection tokens, in their own file so nothing has to import a Nest module to
 * name one. Strings rather than symbols, matching every module here.
 */

/** The READ client. Host-injected; this module opens no connection. */
export const QUEUE_PRISMA = 'kwtech:queue-prisma';

/**
 * The WRITE client, which must expose `$transaction`. Separate from the read
 * one because they are different capabilities: a host may point reads at a
 * replica, and a service that took one client would silently write to it.
 */
export const QUEUE_PRISMA_WRITE = 'kwtech:queue-prisma-write';

export const QUEUE_OPTIONS = 'kwtech:queue-options';

/** The module-kit `LimitChecker`. Unbound means no cap — see `QueueModuleOptions`. */
export const QUEUE_LIMIT_CHECKER = 'kwtech:queue-limit-checker';

/** A `QueueStaffCheck`. Unbound means you may assign a window only to yourself. */
export const QUEUE_STAFF_CHECK = 'kwtech:queue-staff-check';

/** A `QueueStaffDirectory`. Unbound means no picker and no names — "a member". */
export const QUEUE_STAFF_DIRECTORY = 'kwtech:queue-staff-directory';

/** A `QueueWorkspaceLocator`. Unbound means no display can ever open. */
export const QUEUE_WORKSPACE_LOCATOR = 'kwtech:queue-workspace-locator';

/**
 * The pub/sub engine. Unbound means NOT LIVE: every write still works, the
 * console only updates when re-read, and a TV draws its board once and stops.
 *
 * ⚠ Bind the app's OWN engine, never a fresh one: two engines in one process do
 * not see each other's publishes, and the failure is a TV that waits forever.
 */
export const QUEUE_PUBSUB = 'kwtech:queue-pubsub';
