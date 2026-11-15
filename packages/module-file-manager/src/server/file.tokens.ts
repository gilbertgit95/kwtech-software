/**
 * Injection tokens, strings as in every module here. What each one UNBOUND
 * means is written beside it, and every absence fails closed.
 */

/** The READ client. Host-injected; this module opens no connection. */
export const FILE_PRISMA = 'kwtech:file-prisma';

/** The WRITE client, which must expose `$transaction`. */
export const FILE_PRISMA_WRITE = 'kwtech:file-prisma-write';

export const FILE_OPTIONS = 'kwtech:file-options';

/**
 * A `FileStore`: where the bytes live. ⚠ Unbound means FILES ARE OFF: the list
 * still reads, and every upload and download is refused "not set up".
 */
export const FILE_STORE = 'kwtech:file-store';

/**
 * The module-kit `LimitChecker`. ⚠ Unbound means the DECLARED DEFAULT caps,
 * never module-kit's `NULL_LIMIT_CHECKER` (which allows everything).
 */
export const FILE_LIMIT_CHECKER = 'kwtech:file-limit-checker';

/**
 * A `FileMemberDirectory`. Unbound means nobody can be chosen by name (a file
 * is private or the workspace's), and nobody has a name.
 */
export const FILE_MEMBER_DIRECTORY = 'kwtech:file-member-directory';

/** A `FileNotifier`. Unbound means nobody is told a file was shared with them; sharing still works. */
export const FILE_NOTIFIER = 'kwtech:file-notifier';

/**
 * The pub/sub engine. Unbound means NOT LIVE: lists change when read again.
 * ⚠ Bind the app's OWN engine, never a fresh one.
 */
export const FILE_PUBSUB = 'kwtech:file-pubsub';
