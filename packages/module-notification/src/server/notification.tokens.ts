/**
 * Injection tokens, in their own file so nothing has to import a Nest module to
 * name one. Strings rather than symbols, matching every module here.
 */

/** The READ client. Host-injected; this module opens no connection. */
export const NOTIFICATION_PRISMA = 'kwtech:notification-prisma';

/**
 * The WRITE client, which must expose `$transaction`. Separate from the read
 * one because a host may point reads at a replica, and a service that took one
 * client would silently write to it.
 */
export const NOTIFICATION_PRISMA_WRITE = 'kwtech:notification-prisma-write';

export const NOTIFICATION_OPTIONS = 'kwtech:notification-options';

/** The options, resolved once at boot — see `resolveNotificationConfig`. */
export const NOTIFICATION_CONFIG = 'kwtech:notification-config';

/**
 * The pub/sub engine. Unbound means NOT LIVE: every write still works and the
 * inbox reads correctly over HTTP, but nothing arrives by itself — no toast, no
 * badge moving. The bell cannot tell that apart from a quiet day, which is why
 * the app binds it.
 *
 * ⚠ Bind the app's OWN engine, never a fresh one: two engines in one process do
 * not see each other's publishes, and the failure is a subscriber waiting
 * forever with no error.
 */
export const NOTIFICATION_PUBSUB = 'kwtech:notification-pubsub';

/**
 * A `NotificationUserDirectory`. Unbound means the compose screen finds nobody
 * by name and the Sent list shows ids instead of names. Nothing else uses it.
 */
export const NOTIFICATION_USER_DIRECTORY = 'kwtech:notification-user-directory';
