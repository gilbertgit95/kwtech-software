/**
 * Injection tokens, in their own file so nothing has to import a Nest module to
 * name one — the same split `permissions.tokens.ts` makes, and for the same
 * reason: a circular import between the module and the service that the module
 * provides.
 *
 * Strings rather than symbols, matching the two modules already here.
 */

/** The READ client. Host-injected; this module opens no connection. */
export const CHAT_PRISMA = 'kwtech:chat-prisma';

/**
 * The WRITE client, which must expose `$transaction`.
 *
 * Separate from the read one because they are different capabilities, not
 * different instances: a host may point reads at a replica, and a service that
 * took one client would silently write to it.
 */
export const CHAT_PRISMA_WRITE = 'kwtech:chat-prisma-write';

export const CHAT_OPTIONS = 'kwtech:chat-options';

/**
 * The pub/sub engine, if the host runs subscriptions.
 *
 * ⚠ Optional, and its default is a NULL OBJECT that publishes into nothing —
 * so `ChatWriteService` is importable by a worker with no GraphQL layer and no
 * socket. The engine itself is a DEPLOYMENT fact the app owns (see the host's
 * `realtimePubSub()`), and binding a constructor here instead would give the
 * process a second engine whose publishes nobody else sees.
 */
export const CHAT_PUBSUB = 'kwtech:chat-pubsub';

/**
 * Turning an id into a person, and an email into an id.
 *
 * ⚠ THE ONE GENUINELY NEW PORT. Both halves read `auth_user`, which belongs to
 * module-auth — and a module may not import a module (§9). Ten lines in the
 * host, and an app on a different identity provider implements the same
 * interface, which is exactly the portability being bought.
 */
export const CHAT_USER_DIRECTORY = 'kwtech:chat-user-directory';

/**
 * The `LimitChecker` from module-kit, if the host has a permission model.
 *
 * ⚠ Optional, and its default is a NULL OBJECT meaning "no limit", so this
 * module runs in an app with no permissions module at all: unguarded but
 * functional. That is the real test of whether a module is reusable, and it is
 * a design goal rather than an accident.
 */
export const CHAT_LIMIT_CHECKER = 'kwtech:chat-limit-checker';

/**
 * The app-level right to administer a conversation you are not in.
 *
 * ⚠ Optional, and absent means NOBODY HAS IT. A host that has not answered the
 * question has not granted the right — so every conversation is governed by its
 * own participants, which is the shape a deployment with no platform staff
 * wants anyway.
 */
export const CHAT_PLATFORM_ADMIN = 'kwtech:chat-platform-admin';

/**
 * A `ChatDefaultReader` — what the operator chose for the two settings chat
 * declares.
 *
 * ⚠ Optional, and absent means UNSET, which is a working product rather than a
 * degraded one: the creator owns the group and everybody else joins as a
 * member, exactly as they did before the settings existed.
 */
export const CHAT_DEFAULTS = 'kwtech:chat-defaults';
