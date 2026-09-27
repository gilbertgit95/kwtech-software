/**
 * Injection tokens, in their own file so nothing has to import a Nest module to
 * name one. Strings rather than symbols, matching every module here.
 */

/** The READ client. Host-injected; this module opens no connection. */
export const NOTE_PRISMA = 'kwtech:note-prisma';

/**
 * The WRITE client, which must expose `$transaction`. Separate from the read
 * one because they are different capabilities: a host may point reads at a
 * replica, and a service that took one client would silently write to it.
 */
export const NOTE_PRISMA_WRITE = 'kwtech:note-prisma-write';

export const NOTE_OPTIONS = 'kwtech:note-options';

/**
 * The module-kit `LimitChecker`. ⚠ Unbound means the DECLARED DEFAULT cap, not
 * module-kit's `NULL_LIMIT_CHECKER` (which allows everything): an unset cap is a
 * floor, never unlimited.
 */
export const NOTE_LIMIT_CHECKER = 'kwtech:note-limit-checker';

/** A `NoteAccessCheck`. Unbound means you act on your own notes only. */
export const NOTE_ACCESS_CHECK = 'kwtech:note-access-check';

/** A `NoteAuthorDirectory`. Unbound means nobody has a name: "a member". */
export const NOTE_AUTHOR_DIRECTORY = 'kwtech:note-author-directory';

/**
 * The pub/sub engine. Unbound means NOT LIVE: every write still works, and the
 * app only sees other people's changes when it reads again.
 *
 * ⚠ Bind the app's OWN engine, never a fresh one: two engines in one process do
 * not see each other's publishes.
 */
export const NOTE_PUBSUB = 'kwtech:note-pubsub';
